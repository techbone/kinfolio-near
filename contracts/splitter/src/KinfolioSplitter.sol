// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title KinfolioSplitter
/// @notice Splits msg.value between heirs by basis points, on-chain.
/// @dev The Kinfolio NEAR contract signs one EVM transaction per distribution that calls `split`.
///      An EVM tx commits to `value` but not to the sender's balance, so the ratio lives here:
///      a caller who lies about the balance can change the total sent, never who gets what share.
contract KinfolioSplitter {
    event Split(address indexed from, uint256 total, uint256 heirs);

    error LengthMismatch();
    error BadShares();
    error TransferFailed(address to);

    function split(address[] calldata to, uint16[] calldata bps) external payable {
        uint256 n = to.length;
        if (n == 0 || n != bps.length) revert LengthMismatch();

        uint256 sum;
        for (uint256 i; i < n; ++i) {
            if (bps[i] == 0 || to[i] == address(0)) revert BadShares();
            sum += bps[i];
        }
        if (sum != 10_000) revert BadShares();

        uint256 left = msg.value;
        for (uint256 i; i < n; ++i) {
            // The last heir takes the rounding remainder so nothing stays in this contract.
            uint256 amount = i == n - 1 ? left : (msg.value * bps[i]) / 10_000;
            left -= amount;
            (bool ok,) = to[i].call{value: amount}("");
            if (!ok) revert TransferFailed(to[i]);
        }

        emit Split(msg.sender, msg.value, n);
    }
}
