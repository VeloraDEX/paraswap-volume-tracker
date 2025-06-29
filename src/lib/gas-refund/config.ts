import { identity } from 'lodash';
import {
  CHAIN_ID_BASE,
  CHAIN_ID_GOERLI,
  CHAIN_ID_MAINNET,
  CHAIN_ID_OPTIMISM,
} from '../constants';
import { GasRefundV2EpochFlip, isMainnetStaking } from './gas-refund';

type GRPV2GlobalConfig = {
  startEpochTimestamp: number;
  epochDuration: number;
  lastEpochForSePSP2MigrationRefund: number;
  sePSP2PowerMultiplier: number;
};

export const grp2GlobalConfig: GRPV2GlobalConfig = {
  startEpochTimestamp: 1674475200,
  epochDuration: 4 * 7 * 24 * 60 * 60,
  lastEpochForSePSP2MigrationRefund: GasRefundV2EpochFlip + 1, // first 2 epochs inclusive
  sePSP2PowerMultiplier: 2.5,
};

// epoch 56 from/to: 1734955200	1737374400	12/23/2024 12:00:00	1/20/2025 12:00:00
// epoch 57 from/to: 1737374400	1739793600	1/20/2025 12:00:00	2/17/2025 12:00:00
// TODO: set correct epoch when time comes, for now setting it to 56 to test previous distribution as if it happened on v3 staking
export const STAKING_V3_TIMESTAMP = 1734955200;

type GRPV3GlobalConfig = {
  startEpochTimestamp: number;
  epochDuration: number;
  seXYZPowerMultiplier: number;
};

export const grp3GlobalConfig: GRPV3GlobalConfig = {
  startEpochTimestamp: STAKING_V3_TIMESTAMP,
  epochDuration: 4 * 7 * 24 * 60 * 60,
  seXYZPowerMultiplier: 2.5,
};

type GRP2ConfigByChain = {
  stakingStartCalcTimestamp?: number; // the timestamp of staking enabling for a particular chain
};

export const grp2CConfigParticularities: {
  [network: number]: GRP2ConfigByChain;
} = {
  [CHAIN_ID_GOERLI]: {},
  [CHAIN_ID_MAINNET]: {},
  [CHAIN_ID_OPTIMISM]: {
    stakingStartCalcTimestamp: 1691409600,
  },
};

export const grpConfigParticularities_V3: {
  [network: number]: GRP2ConfigByChain;
} = {
  // @TODO: adjust here
  [CHAIN_ID_MAINNET]: {
    stakingStartCalcTimestamp:
      Math.round(new Date('May-14-2025 06:47:47 AM UTC').getTime() / 1000) + 5, // tx that deploys seVLR https://etherscan.io/tx/0xc6f5077dc180b570211fd3e381bbe2b568466bfd46aa3f0c68310d8e2bfd7efc
  },
  [CHAIN_ID_BASE]: {
    stakingStartCalcTimestamp:
      Math.round(new Date('May-14-2025 07:01:57 AM UTC').getTime() / 1000) + 5, // tx that deploys seVLR https://basescan.org/tx/0x4321c740351edb99a794df750ce4eaca04f798fdc20ff5ea82d63cb98e838744
  },
  [CHAIN_ID_OPTIMISM]: {
    stakingStartCalcTimestamp:
      Math.round(new Date('May-14-2025 07:04:53 AM UTC').getTime() / 1000) + 5, // tx that deploys seVLR https://optimistic.etherscan.io/tx/0xfc19542ceccbdf6e0f1e7e62930f834600f7941b4204aaec52b0c38dc37bbe02
  },
};

console.log(grpConfigParticularities_V3);
type GRPV2ConfigByChain = {
  sePSP1: string;
  sePSP2: string;
  bpt: string;
  poolId: string;
  psp1ToPsp2Migrator?: string;
  sePSP1ToSePSP2Migrator: string;
};

type GRPV2ConfigByChain_V3 = {
  seXYZ: string;
  bpt: string;
  // psp1ToPsp2Migrator?: string;  // unlike with v1->v2, we don't refund migration v2->v3 txs
};

const l = (s: string) => s.toLowerCase();

export const grp2ConfigByChain: {
  [chainId: number]: GRPV2ConfigByChain;
} = {
  [CHAIN_ID_MAINNET]: {
    sePSP1: l('0x716fbc68e0c761684d9280484243ff094cc5ffab'),
    sePSP2: l('0x593f39a4ba26a9c8ed2128ac95d109e8e403c485'),
    bpt: l('0xCB0e14e96f2cEFA8550ad8e4aeA344F211E5061d'),
    poolId: l(
      '0xcb0e14e96f2cefa8550ad8e4aea344f211e5061d00020000000000000000011a',
    ),
    psp1ToPsp2Migrator: l('0x81DF863E89429B0d4230a2A922DE4f37f718EED3'),
    sePSP1ToSePSP2Migrator: l('0xf6ef5292b8157c2e604363f92d0f1d176e0dc1be'),
  },
  [CHAIN_ID_GOERLI]: {
    sePSP1: l('0xFef5392ac7cE391dD63838a73E6506F9948A9Afa'),
    sePSP2: l('0x2e445Be127FC9d406dC4eD3E320B0f5A020cb4A0'),
    bpt: l('0xdedB0a5aBC452164Fd241dA019741026f6EFdC74'),
    poolId: l(
      '0xdedb0a5abc452164fd241da019741026f6efdc74000200000000000000000223',
    ),
    psp1ToPsp2Migrator: l('0x8580D057198E80ddE65522180fd8edBeA67D61E6'),
    sePSP1ToSePSP2Migrator: '0x',
  },
  [CHAIN_ID_OPTIMISM]: {
    sePSP1: l('0x8C934b7dBc782568d14ceaBbEAeDF37cB6348615'),
    sePSP2: l('0x26Ee65874f5DbEfa629EB103E7BbB2DEAF4fB2c8'),
    bpt: l('0x11f0b5cca01b0f0a9fe6265ad6e8ee3419c68440'),
    poolId: l(
      '0x11f0b5cca01b0f0a9fe6265ad6e8ee3419c684400002000000000000000000d4',
    ),
    sePSP1ToSePSP2Migrator: l('0x18e1A8431Ce39cBFe95958207dA2d68A7Ef8C583'),
  },
};

export const grp2ConfigByChain_V3: {
  [chainId: number]: GRPV2ConfigByChain_V3;
} = {
  [CHAIN_ID_MAINNET]: {
    seXYZ: l('0x53fE8d8C00F9FBF55C4276b9cf8451f586D21055'),
    bpt: l('0x01b3F3aabFf34e266A98e771438320DF98d447dD'),
  },
  [CHAIN_ID_OPTIMISM]: {
    seXYZ: l('0xCbed2888F7F969841a2df28DDA972D40264FCcda'),
    bpt: l('0x4291b31b17511A26E4131da396145Ef6A5f83875'),
  },
  [CHAIN_ID_BASE]: {
    seXYZ: l('0xa85A6Ccff277a69B80FCd33Bec7DE066147ABF75'),
    bpt: l('0xEe1e5301dc293E1468fAc27B9b53F309f0AE8344'),
  },
};

export const STAKING_CHAIN_IDS_V3 =
  Object.keys(grp2ConfigByChain_V3).map(Number);

const twistChains = (chain1: number, chain2: number) => (chainId: number) =>
  chainId === chain1 ? chain2 : chain2;

type ChainTwister = (chainId: number) => number;
export const forceStakingChainId: ChainTwister = !isMainnetStaking
  ? twistChains(CHAIN_ID_MAINNET, CHAIN_ID_GOERLI)
  : identity;
export const forceEthereumMainnet: ChainTwister = !isMainnetStaking
  ? twistChains(CHAIN_ID_GOERLI, CHAIN_ID_MAINNET)
  : identity;
