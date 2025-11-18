import axios from 'axios';
import { assert } from 'ts-essentials';

export type MinParaBoostData_V3 = {
  account: string;
  score: string;
  stakesScore: string;
  seXYZUnderlyingXYZBalance: string;
  paraBoostFactor: string;
};

export async function fetchAccountsScores_V3(
  epochv2: number,
): Promise<MinParaBoostData_V3[]> {
  const { data } = await axios.get<MinParaBoostData_V3[]>(
    `${process.env.VELORA_API_BASE_URL}/stk/paraboost/v3/list?epoch=${epochv2}`,
  );

  assert(
    data.length > 0,
    'logic error: unlikely that no paraboost was recorded',
  );

  return data;
}
