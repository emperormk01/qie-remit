// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title InvoiceRegistry — native QIE pull/push payment primitive.
/// @notice No ERC-20 dependency. Payers pay in native QIE (msg.value == amount).
///         The operator (issuer) creates invoices; anyone may pay them.
contract InvoiceRegistry {
    address public owner;
    mapping(address => bool) public issuers;

    struct Invoice {
        address creator;
        uint256 amount;      // in wei (native QIE)
        bool paid;
        uint256 paidAt;
        address payer;
        bool cancelled;
    }
    mapping(uint256 => Invoice) public invoices;
    uint256 public nextId;

    event InvoiceCreated(uint256 indexed id, address indexed creator, uint256 amount);
    event Paid(uint256 indexed id, address indexed payer, address indexed creator, uint256 amount, uint256 paidAt);
    event InvoiceCancelled(uint256 indexed id);
    event IssuerSet(address indexed account, bool allowed);

    error NotIssuer();
    error NotOwner();
    error ZeroAddress();
    error InvalidAmount();
    error AlreadyPaid();
    error NotPayable();
    error TransferFailed();
    error WrongValue();

    constructor() {
        owner = msg.sender;
        issuers[msg.sender] = true;
        nextId = 1;
        emit IssuerSet(msg.sender, true);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyIssuer() {
        if (!issuers[msg.sender]) revert NotIssuer();
        _;
    }

    function setIssuer(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        issuers[account] = allowed;
        emit IssuerSet(account, allowed);
    }

    /// @notice Create an invoice for `creator` payable in native QIE.
    function createInvoice(address creator, uint256 amount) external onlyIssuer returns (uint256 id) {
        if (creator == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        id = nextId++;
        invoices[id] = Invoice({ creator: creator, amount: amount, paid: false, paidAt: 0, payer: address(0), cancelled: false });
        emit InvoiceCreated(id, creator, amount);
    }

    /// @notice Pay an invoice with native QIE. Requires msg.value == amount.
    function payInvoice(uint256 id) external payable {
        Invoice storage inv = invoices[id];
        if (inv.creator == address(0)) revert NotPayable();
        if (inv.paid) revert AlreadyPaid();
        if (inv.cancelled) revert NotPayable();
        if (msg.value != inv.amount) revert WrongValue();

        inv.paid = true;
        inv.paidAt = block.timestamp;
        inv.payer = msg.sender;

        (bool ok, ) = payable(inv.creator).call{value: inv.amount}("");
        if (!ok) revert TransferFailed();

        emit Paid(id, msg.sender, inv.creator, inv.amount, inv.paidAt);
    }

    function cancelInvoice(uint256 id) external onlyIssuer {
        Invoice storage inv = invoices[id];
        if (inv.creator == address(0)) revert NotPayable();
        if (inv.paid) revert AlreadyPaid();
        inv.cancelled = true;
        emit InvoiceCancelled(id);
    }

    function getInvoice(uint256 id) external view returns (address creator, uint256 amount, bool paid, uint256 paidAt, address payer, bool cancelled) {
        Invoice storage inv = invoices[id];
        return (inv.creator, inv.amount, inv.paid, inv.paidAt, inv.payer, inv.cancelled);
    }

    function isPaid(uint256 id) external view returns (bool) {
        return invoices[id].paid;
    }

    /// @notice Recover stuck native QIE (e.g. from failed pulls). Owner only.
    function withdraw(address payable to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }

    receive() external payable {}
}
