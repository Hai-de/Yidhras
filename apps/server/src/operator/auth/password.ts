import bcrypt from 'bcrypt'

import { DEFAULT_BCRYPT_ROUNDS } from '../constants.js'

export const hashPassword = async (
  password: string,
  rounds: number = DEFAULT_BCRYPT_ROUNDS
): Promise<string> => {
  return bcrypt.hash(password, rounds)
}

export const comparePassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash)
}
