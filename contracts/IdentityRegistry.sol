// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IdentityRegistry
/// @notice Mirrors QIE Pass ("verify once, use everywhere"). A trusted verifier
///         attests that a wallet belongs to a named, KYC'd user. dApps read
///         `isVerified(addr)` to show a "Verified by QIE Pass" badge.
///         When QIE publishes its real Pass contract, point the dApp at that
///         address instead -- the read ABI (`isVerified`/`getIdentity`) matches.
contract IdentityRegistry {
    struct Identity {
        string name;
        bool verified;
        uint64 verifiedAt;
    }

    mapping(address => Identity) private _ids;
    mapping(address => bool) public verifier;
    address public owner;

    event Attested(address indexed user, string name, uint64 verifiedAt);
    event Revoked(address indexed user);
    event VerifierSet(address indexed who, bool ok);

    error NotVerifier();
    error NotOwner();
    error EmptyName();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyVerifier() {
        if (!verifier[msg.sender]) revert NotVerifier();
        _;
    }

    constructor() {
        owner = msg.sender;
        verifier[msg.sender] = true;
        emit VerifierSet(msg.sender, true);
    }

    function setVerifier(address who, bool ok) external onlyOwner {
        verifier[who] = ok;
        emit VerifierSet(who, ok);
    }

    /// @notice Verifier attests a user. `verifiedAt` = block timestamp.
    function attest(address user, string calldata name) external onlyVerifier {
        bytes memory nb = bytes(name);
        if (nb.length == 0) revert EmptyName();
        _ids[user] = Identity({name: name, verified: true, verifiedAt: uint64(block.timestamp)});
        emit Attested(user, name, uint64(block.timestamp));
    }

    function revoke(address user) external onlyVerifier {
        _ids[user].verified = false;
        emit Revoked(user);
    }

    function isVerified(address user) external view returns (bool) {
        return _ids[user].verified;
    }

    function getIdentity(address user) external view returns (string memory name, bool verified, uint64 verifiedAt) {
        Identity storage id = _ids[user];
        return (id.name, id.verified, id.verifiedAt);
    }
}
