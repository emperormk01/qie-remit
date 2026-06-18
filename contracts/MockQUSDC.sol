// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockQUSDC
/// @notice Testnet-only QUSDC stablecoin mock (6 decimals). Public mint lets
///         demo payers fund themselves. Swap for the official QUSDC contract
///         address once QIE docs publish it.
contract MockQUSDC {
    string public constant name = "QIE USD Coin (Test)";
    string public constant symbol = "QUSDC";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public minter;

    address public owner;
    bool public mintOpen; // when true, anyone can mint demo tokens

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MintOpened(bool open);

    error NotMinter();
    error MintClosed();
    error ZeroAddress();
    error Insufficient();
    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        minter[msg.sender] = true;
        mintOpen = true; // demo-friendly by default
        emit MintOpened(true);
    }

    function setMinter(address who, bool ok) external onlyOwner {
        minter[who] = ok;
    }

    function setMintOpen(bool open) external onlyOwner {
        mintOpen = open;
        emit MintOpened(open);
    }

    /// @notice Mint demo tokens. Minter role can always mint; anyone can mint
    ///         when `mintOpen` is true (capped per call to 10,000 QUSDC).
    function mint(address to, uint256 amount) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        if (!minter[msg.sender]) {
            if (!mintOpen) revert MintClosed();
            if (amount > 10_000 * 1e6) amount = 10_000 * 1e6; // demo cap
        }
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            if (a < amount) revert Insufficient();
            allowance[from][msg.sender] = a - amount;
            emit Approval(from, msg.sender, a - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert Insufficient();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
