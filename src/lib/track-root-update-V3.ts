import database from '../database';
import { getCurrentEpoch } from './gas-refund/epoch-helpers';
import * as Sequelize from 'sequelize';
import { Provider } from './provider';
import { Contract } from 'ethers';
import { MerkleRedeemAddressVLR } from './gas-refund/gas-refund-api';
import * as MerkleRedeemAbi from './abi/merkle-redeem.abi.json';
import axios from 'axios';
import {
  GasRefundDistributionData,
  GasRefundParticipantData,
} from './gas-refund/gas-refund';
import { GasRefundDistribution } from '../models/GasRefundDistribution';
import { GasRefundParticipation } from '../models/GasRefundParticipation';
import { STAKING_CHAIN_IDS_V3 } from './gas-refund/config_V3';

const logger = global.LOGGER('TrackRootUpdate_V3');

const IPFS_FOLDER_BY_EPOCH: Record<string, string> = {
  // 61: 'https://copper-total-fly-652.mypinata.cloud/ipfs/bafybeidvcmiikh6dg3ihn433mowktqhfcucvpqcr73ydm43vg77xglkkbe',
  // 70: 'http://localhost:3232/tmp',
  65: 'https://vlr-wakeuplabs.mypinata.cloud/ipfs/bafybeift4l4qvwszcuytypyy3ypg5syp2wtsigip5aofjetxwl43u54zam',
};
export async function trackRootUpdate_V3() {
  const epoch = getCurrentEpoch();
  const previousEpoch = epoch - 1;
  const ipfsFolder = IPFS_FOLDER_BY_EPOCH[previousEpoch];
  if (!ipfsFolder) {
    logger.info(
      `No IPFS folder found for epoch ${previousEpoch}, skipping root update tracking.`,
    );
    return;
  }

  for (const chainId of STAKING_CHAIN_IDS_V3) {
    if (!MerkleRedeemAddressVLR[chainId]) {
      // TODO: throw error here, allowing to passthrough for now just for dev/testing purposes
      logger.info(
        `No MerkleRedeemAddressVLR found for chainId ${chainId}, skipping root update tracking.`,
      );
      continue;
    }
    const distributionFromDb = await database.sequelize.query(
      `SELECT * FROM "GasRefundDistributions" WHERE epoch = :epoch and "chainId"=:chainId;`,
      {
        type: Sequelize.QueryTypes.SELECT,
        replacements: {
          chainId,
          epoch: previousEpoch,
        },
      },
    );
    if (distributionFromDb.length === 0) {
      logger.info(
        `No distribution found in DB for epoch ${previousEpoch} and chainId ${chainId} in the DB. Loading onchain value`,
      );
    } else {
      // distribution is already in DB, no need to update
      logger.info(
        `Latest distribution is already in the DB for the epoch ${previousEpoch} and chainId ${chainId}.`,
      );
      continue;
    }
    const provider = Provider.getJsonRpcProvider(chainId);
    const contract = new Contract(
      MerkleRedeemAddressVLR[chainId],
      MerkleRedeemAbi,
      provider,
    );
    const currentRoot = (
      await contract.weekMerkleRoots(previousEpoch)
    ).toLowerCase();

    if (BigInt(currentRoot) === BigInt(0)) {
      logger.info(
        `Current root for epoch ${previousEpoch} on chain ${chainId} is 0 (i.e. not executed yet), skipping update.`,
      );
    } else {
      logger.info(
        `The epoch was distributed on chain. Now will load data from IPFS folder and update DB`,
      );

      await loadDataFromIpfsAndUpdateDb(ipfsFolder, previousEpoch, chainId);
    }
  }
}

async function loadDataFromIpfsAndUpdateDb(
  ipfsFolder: string,
  epoch: number,
  chainId: number,
) {
  const url = `${ipfsFolder}/merkle-data-chain-${chainId}-epoch-${epoch}.json`;
  logger.info('IPFS url to be processed: ', url);

  const { data } = await axios.get(url);

  const { root, proofs: proofsByUser } = data;

  const distributionData: GasRefundDistributionData = {
    epoch: epoch,
    chainId,
    totalPSPAmountToRefund: root.totalAmount,
    merkleRoot: root.merkleRoot,
  };
  await GasRefundDistribution.bulkCreate([distributionData]);

  const participations: GasRefundParticipantData[] = proofsByUser.map(
    ({
      amount,
      amountsByProgram,
      grpChainBreakdown,
      merkleProofs,
      user,
    }: any) => ({
      epoch,
      chainId,
      address: String(user).toLowerCase(),
      amount,
      amountsByProgram,
      merkleProofs,
      GRPChainBreakDown: grpChainBreakdown,
    }),
  );

  await GasRefundParticipation.bulkCreate(participations);
}
