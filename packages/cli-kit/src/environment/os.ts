import { platform, arch, release } from 'node:os';

export function getOS(): string {
  return platform();
}

export function getArch(): string {
  return arch();
}

export function getOSInfo(): { platform: string; arch: string; release: string } {
  return {
    platform: platform(),
    arch: arch(),
    release: release(),
  };
}

export function checkNodeVersion(minimum = '20.0.0'): boolean {
  const current = process.versions.node;
  const [curMajor] = current.split('.').map(Number);
  const [minMajor] = minimum.split('.').map(Number);
  return curMajor >= minMajor;
}
