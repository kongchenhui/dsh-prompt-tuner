/**
 * Read the manifest of the package a build config belongs to.
 * @param packageDir - the package's own directory.
 * @returns the parsed manifest with a string name.
 * @throws when package.json is unreadable, is not JSON, or declares no name.
 */
import { readFile } from 'node:fs/promises'

export interface PackageManifest {
  readonly name: string
}

export async function readPackageManifest(packageDir: string): Promise<PackageManifest> {
  const manifestPath = `${packageDir}/package.json`
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`tsdown: cannot read ${manifestPath}`, { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null || !('name' in parsed) || typeof parsed.name !== 'string') {
    throw new Error(`tsdown: ${manifestPath} declares no string package name`)
  }
  return parsed as PackageManifest
}
