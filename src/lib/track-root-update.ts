import database from '../database';
import { STAKING_CHAIN_IDS } from './constants';
import { getCurrentEpoch } from './gas-refund/epoch-helpers';
import * as Sequelize from 'sequelize';
import { Provider } from './provider';
import { Contract } from 'ethers';
import { MerkleRedeemAddressSePSP1 } from './gas-refund/gas-refund-api';
import * as MerkleRedeemAbi from './abi/merkle-redeem.abi.json';
import axios from 'axios';
import {
  GasRefundDistributionData,
  GasRefundParticipantData,
} from './gas-refund/gas-refund';
import { GasRefundDistribution } from '../models/GasRefundDistribution';
import { GasRefundParticipation } from '../models/GasRefundParticipation';

const logger = global.LOGGER('TrackRootUpdate');

const IPFS_FOLDER_BY_EPOCH: Record<string, string> = {
  61: 'https://copper-total-fly-652.mypinata.cloud/ipfs/bafybeidvcmiikh6dg3ihn433mowktqhfcucvpqcr73ydm43vg77xglkkbe',
};
export async function trackRootUpdate() {
  const epoch = getCurrentEpoch();
  const previousEpoch = epoch - 1;
  const ipfsFolder = IPFS_FOLDER_BY_EPOCH[previousEpoch];
  if (!ipfsFolder) {
    logger.info(
      `No IPFS folder found for epoch ${previousEpoch}, skipping root update tracking.`,
    );
    return;
  }

  for (const chainId of STAKING_CHAIN_IDS) {
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

    const contract = new Contract(
      MerkleRedeemAddressSePSP1[chainId],
      MerkleRedeemAbi,
      Provider.getJsonRpcProvider(chainId),
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
  debugger;
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
      address: user,
      amount,
      amountsByProgram,
      merkleProofs,
      GRPChainBreakDown: grpChainBreakdown,
    }),
  );

  await GasRefundParticipation.bulkCreate(participations);
}
