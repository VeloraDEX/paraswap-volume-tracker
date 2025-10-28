import * as ERC20ABI from '../../../../src/lib/abi/erc20.abi.json';
import * as BVaultABI from '../../../../src/lib/abi/balancer-vault.abi.json';
import * as MulticallV3ABI from '../../../../src/lib/abi/multicall-v3.abi.json';
import {
  XYZ_ADDRESS,
  MULTICALL_ADDRESS_V3,
  MulticallEncodedData_V3,
  Balancer_80VLR_20WETH_address,
  Balancer_80VLR_20WETH_poolId,
  BalancerVaultAddress,
  // BalancerVaultAddress_V3,
} from '../../../../src/lib/constants';
import { Provider } from '../../../../src/lib/provider';
import { BigNumber as EthersBN, Contract } from 'ethers';
import { Interface } from '@ethersproject/abi';
import BigNumber from 'bignumber.js';
import { grp2ConfigByChain_V3 } from '../../../../src/lib/gas-refund/config_V3';

export type BPTState = {
  bptTotalSupply: BigNumber;
  xyzBalance: BigNumber;
  ethBalance: BigNumber;
};

export const balancerV3Abi = [
  `
  function getPoolTokenInfo(address pool) 
    external 
    view 
    returns (
        address[] tokens,
        tuple[] tokenInfo,
        uint256[] balancesRaw,
        uint256[] lastBalancesLiveScaled18
    )
    `,
  //sample liquidity added https://etherscan.io/tx/0x3ddcaa3795fc1c836cf6909df989a7db61d655c753a4fad9caee1bdc43be8875#eventlog
  `
  event LiquidityAdded(
    address indexed pool,
    address indexed liquidityProvider,
    uint8 indexed kind,
    uint256 totalSupply,
    uint256[] amountsAddedRaw,
    uint256[] swapFeeAmountsRaw
  )
  `,
  `
  event LiquidityRemoved(
    address indexed pool,
    address indexed liquidityProvider,
    uint8 indexed kind,
    uint256 totalSupply,
    uint256[] amountsRemovedRaw,
    uint256[] swapFeeAmountsRaw
  )
  `,
  `
  event Swap(
    address indexed pool,
    address indexed tokenIn,
    address indexed tokenOut,
    uint256 amountIn,
    uint256 amountOut,
    uint256 swapFeePercentage,
    uint256 swapFeeAmount
  )
  `,
];

export class BPTHelper_V3 {
  private static instance: { [chainId: number]: BPTHelper_V3 } = {};  

  static getInstance(chainId: number) {
    if (!BPTHelper_V3.instance[chainId]) {
      BPTHelper_V3.instance[chainId] = new BPTHelper_V3(chainId);
    }
    return BPTHelper_V3.instance[chainId];
  }

  multicallContract: Contract;
  bVaultIface: Interface;
  erc20Iface: Interface;
  private isXYZToken0?: boolean = undefined;

  constructor(protected chainId: number) {
    const provider = Provider.getJsonRpcProvider(this.chainId);

    this.multicallContract = new Contract(
      MULTICALL_ADDRESS_V3[this.chainId],
      MulticallV3ABI,
      provider,
    );

    this.bVaultIface = new Interface(BVaultABI);
    this.erc20Iface = new Interface(ERC20ABI);
  }

  async getIsXYZToken0() {
    if (this.isXYZToken0 !== undefined) {
      return this.isXYZToken0;
    }
    const bpt = grp2ConfigByChain_V3[this.chainId].bpt;
    const contract = new Contract(
      BalancerVaultAddress,
      BVaultABI,
      Provider.getJsonRpcProvider(this.chainId),
    );

    const { tokens } = await contract.getPoolTokens(Balancer_80VLR_20WETH_poolId[this.chainId]);

    const xyzAddressLowercased = XYZ_ADDRESS[this.chainId].toLowerCase();

    this.isXYZToken0 = tokens[0].toLowerCase() === xyzAddressLowercased;

    return this.isXYZToken0;
  }

  async fetchBPtState(blockNumber?: number): Promise<BPTState> {
    // const bpt = grp2ConfigByChain_V3[this.chainId].bpt;
    const multicallData = [
      {
        target: Balancer_80VLR_20WETH_address[this.chainId], // bpt,
        callData: this.erc20Iface.encodeFunctionData('totalSupply', []),
        // allowFailure: false,
      },
      {
        target: BalancerVaultAddress,
        callData: this.bVaultIface.encodeFunctionData('getPoolTokens', [
          Balancer_80VLR_20WETH_poolId[this.chainId] // bpt,
        ]),
        // allowFailure: false,
      },
    ];

    const rawResults: MulticallEncodedData_V3 =
      await this.multicallContract.callStatic.aggregate3(multicallData, {
        blockTag: blockNumber,
      });

    const bptTotalSupply = new BigNumber(
      this.erc20Iface
        .decodeFunctionResult('totalSupply', rawResults[0].returnData)
        .toString(),
    );

    const { tokens, balances } =
      this.bVaultIface.decodeFunctionResult(
        'getPoolTokens',
        rawResults[1].returnData,
      ) as unknown as {
        tokens: [string, string];
        balances: [EthersBN, EthersBN];
      };

    const isXYZToken0 =
      tokens[0].toLowerCase() === XYZ_ADDRESS[this.chainId].toLowerCase();
    const [xyzPoolBalance, etherPoolBalance] = isXYZToken0
      ? balances
      : [...balances].reverse();

    return {
      bptTotalSupply,
      xyzBalance: new BigNumber(xyzPoolBalance.toString()),
      ethBalance: new BigNumber(etherPoolBalance.toString()),
    };
  }
}
