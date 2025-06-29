import {
  Table,
  Model,
  Column,
  PrimaryKey,
  DataType,
  AutoIncrement,
  Index,
  Default,
} from 'sequelize-typescript';
import {
  GasRefundTransactionData_V3,
  TransactionStatus,
} from '../lib/gas-refund/gas-refund';

import {
  DataType_ADDRESS,
  DataType_KECCAK256_HASHED_VALUE,
} from '../lib/sql-data-types';

@Table
export class GasRefundTransaction_V3 extends Model<GasRefundTransactionData_V3> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Index
  @Column(DataType.SMALLINT)
  epoch: number;

  @Column(DataType_ADDRESS)
  address: string;

  @Column(DataType.INTEGER)
  chainId: number;

  @Column(DataType_KECCAK256_HASHED_VALUE)
  hash: string;

  @Column(DataType.INTEGER)
  block: number;

  @Column(DataType.INTEGER)
  timestamp: number;

  @Column(DataType.DECIMAL)
  gasUsedUSD: string;

  @Column(DataType.DECIMAL)
  vlrUsd: number;

  @Column(DataType.DECIMAL)
  totalStakeAmountVLR: string;

  @Column(DataType.DECIMAL)
  refundedAmountVLR: string;

  @Column(DataType.DECIMAL)
  refundedAmountUSD: string;

  @Default(1)
  @Column(DataType.DECIMAL)
  paraBoostFactor: number;

  @Index
  @Column(DataType_ADDRESS)
  contract: string;

  @Index
  @Column(DataType.STRING)
  status: TransactionStatus;
}
