import {
  Model,
  Column,
  DataType,
  createIndexDecorator,
  Table,
} from 'sequelize-typescript';
import {
  DataType_ADDRESS,
  DataType_KECCAK256_HASHED_VALUE,
} from '../lib/sql-data-types';

export interface GasRefundTransactionStakeSnapshotData_V3 {
  transactionChainId: number;
  transactionHash: string;
  staker: string;
  stakeChainId: number;
  stakeScore: string; // should be computed by JS, not by SQL
  seXYZBalance: string;
  bptTotalSupply: string;
  bptXYZBalance: string;
}

const compositeIndex = createIndexDecorator({
  name: 'txChain_txHash_staker_stakeChain_v3',
  type: 'UNIQUE',
  unique: true,
});

@Table
export class GasRefundTransactionStakeSnapshot_V3 extends Model<GasRefundTransactionStakeSnapshotData_V3> {
  @compositeIndex
  @Column(DataType.INTEGER)
  transactionChainId: number;

  @compositeIndex
  @Column(DataType_KECCAK256_HASHED_VALUE)
  transactionHash: string;

  @compositeIndex
  @Column(DataType_ADDRESS)
  staker: string;

  @compositeIndex
  @Column(DataType.INTEGER)
  stakeChainId: number;

  @Column(DataType.DECIMAL)
  stakeScore: string; // should be computed by JS, not by SQL

  @Column(DataType.DECIMAL)
  seXYZBalance: string;

  @Column(DataType.DECIMAL)
  bptTotalSupply: string;

  @Column(DataType.DECIMAL)
  bptXYZBalance: string;
}
