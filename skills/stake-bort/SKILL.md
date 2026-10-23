---
name: stake-bort
description: Stake BNB behind a BORT agent you own on the BAP578Staking contract to earn a share of staking rewards, with a flexible option or 30, 90 or 180 day locks (1.0x to 2.5x). Despite the name, the stake is BNB, not the BORT token.
version: 2.0.0
license: MIT
metadata:
  author: BORT-AGENTS
---

# Stake on a BORT agent

BAP578Staking (`0x0530899315dd4D1Af0496Fd6dd3AD4e355165F80`, UUPS proxy, BNB Smart Chain, chain id 56) takes BNB, the native coin, staked behind an agent you own. There is no token approval, and the BORT token is not staked here: the amount is the `value` of the `stake` call. In the dapp (https://bortagent.xyz): connect a wallet, then **Staking** (`#/staking`).

## When to use this skill

- The user asks to stake on, lock or earn rewards with a BORT agent
- The user wants to compare lock periods, or read a position, its rewards or its unlock date

## Rules (read from the live contract)

- Minimum 0.01 BNB per stake or top-up (`MIN_STAKE`). Maximum 50 BNB per agent in total, counting every position of every staker (`MAX_STAKE_PER_AGENT`).
- Only the agent's current owner can open a stake, and the agent must not be terminated. Check `getState(agentId).owner` on the BAP578 collection `0x15b15DF2fFFF6653C21C11b93fB8A7718CE854Ce` first.
- `lockPeriod` is a number. The multiplier weights your share of the rewards; it is not a promised return.

| `lockPeriod` | Duration | Multiplier |
|---|---|---|
| `0` | Flexible, leave any time | 1.0x |
| `1` | 30 days | 1.25x |
| `2` | 90 days | 1.75x |
| `3` | 180 days | 2.5x |

- Shares = amount x lock multiplier x the agent's bonus. `getAgentStakeInfo(agentId).bonusMultiplier` is in basis points: `10000` is 1.0x, `0` means nobody has staked on the agent yet (counts as 1.0x), `12500` is set when the agent's on-chain `experience` text is set, and the cap is `15000`.
- Leaving a lock early with `emergencyUnstake` returns 75% of the stake and pays no rewards; the contract keeps the 25% penalty. After `lockEndTime`, `unstake` returns everything.

## Rewards

Rewards are BNB sent to the staking contract (normally the BORT Treasury's staking allocation), released over 7 days and split by shares. There can be long stretches with none. Before saying anything about returns, read `getPoolStats()`: `totalStaked`, `totalShares`, `rewardRate` (wei per second) and `pendingRewards`. In the pool stats that last field is only a running total of rewards received, not what is unpaid; the unpaid amount of one position is `pendingRewards(stakeId)`. Never quote a rate from memory.

## Calls (on the staking contract)

| Call | Selector | Notes |
|---|---|---|
| `stake(uint256 agentId, uint8 lockPeriod)` payable | `0x10087fb1` | opens a position, returns its `stakeId` |
| `addToStake(uint256 stakeId)` payable | `0x685d7306` | adds BNB to your position, at least 0.01 |
| `claimRewards(uint256 stakeId)` | `0x0962ef79` | pays that position's pending rewards in BNB |
| `claimAllRewards()` | `0x0b83a727` | the same for every position of the caller |
| `compoundRewards(uint256 stakeId)` | `0x656c579f` | adds pending rewards to the stake (counts toward the 50 BNB cap) |
| `unstake(uint256 stakeId)` | `0x2e17de78` | stake plus pending rewards; a locked position only after `lockEndTime` |
| `emergencyUnstake(uint256 stakeId)` | `0x012ce501` | during a lock only, 25% penalty |
| `getUserStakes(address user)` view | `0x842e2981` | positions `(stakeId, agentId, staker, amount, shares, lockPeriod, startTime, lockEndTime, lastClaimTime, totalRewardsClaimed, status)` |
| `pendingRewards(uint256 stakeId)` view | `0x7dcb2abf` | rewards earned so far |
| `getAgentStakeInfo(uint256 agentId)` view | `0x436fdc34` | `(totalStaked, stakerCount, bonusMultiplier, learningEnabled)` |
| `getPoolStats()` view | `0xbbb85188` | pool totals and `rewardRate` |

`status` is `0` none, `1` active (flexible), `2` locked, `4` unstaked (`3` is never stored). A locked position past its `lockEndTime` still reads `2` until it is unstaked, so decide from `lockEndTime`. Use `eth_call` against `https://bsc-dataseed.bnbchain.org` for the views.

Do not call `restake`. It discards a position's unclaimed rewards instead of paying them (the dapp has no restake button for that reason). To change tier, `unstake` once the lock has ended, then `stake` again.

## Flow

1. Read `getState(agentId)` and `getPoolStats()`. Confirm the user's wallet owns the agent.
2. Ask for the agent, the amount (at least 0.01 BNB) and the tier. For tiers 1 to 3 state the unlock date and that leaving early costs 25%.
3. Build `stake(agentId, lockPeriod)` with the amount as `value`. The user's wallet shows `to` (the staking contract), the value and the call, and signs.
4. After the receipt, read `getUserStakes(wallet)` and report the `stakeId`, `lockEndTime` and `amount`.

## Rules for the agent

- Stake only what the user asked for, from their own wallet, behind an agent they own. Never ask for a private key.
- A stake does not move with the agent. The live BAP578 collection does not notify the staking contract on a transfer, so a stake stays with the wallet that opened it, can be unstaked from that wallet, and still counts toward the agent's 50 BNB cap after a sale. Do not tell a user otherwise.
- While the CircuitBreaker (`0x907c460B8A9d698e2Db460d86DdafA5BB5f12b0A`, `globalPause()`) is paused, `stake`, `unstake` and the claims revert with `Staking: system paused`. Relay a revert reason as returned.
- Give no investment advice.

Install: `npx skills add BORT-AGENTS/bort-skills --skill stake-bort`
