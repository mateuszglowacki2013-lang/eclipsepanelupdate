export const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export function parseSemver(v: string): { nums: number[]; pre: string[] | null } | null {
  if (!SEMVER_RE.test(v)) return null;
  const [core = "", pre] = v.split("-");
  return {
    nums: core.split(".").map(Number),
    pre: pre ? pre.split(".") : null,
  };
}

/** Returns >0 if a>b, <0 if a<b, 0 if equal. Prerelease < release. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error("Invalid semver");
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i]! !== pb.nums[i]!) return pa.nums[i]! - pb.nums[i]!;
  }
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    const xNum = !Number.isNaN(nx) && /^\d+$/.test(x);
    const yNum = !Number.isNaN(ny) && /^\d+$/.test(y);
    if (xNum && yNum) {
      if (nx !== ny) return nx - ny;
    } else if (xNum) return -1;
    else if (yNum) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function bumpPatch(v: string): string {
  const p = parseSemver(v);
  if (!p) return "1.0.0";
  return `${p.nums[0]}.${p.nums[1]}.${p.nums[2]! + 1}`;
}
