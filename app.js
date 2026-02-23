

// app.js (fixed + robust for ethers v5/v6)
// - Fix StakingV5 loop index bug (use i, not 1)
// - Add safer error logs (no silent fail)
// - Compatible with ethers v5 + v6

;(() => {
"use strict";

const C = window.APP_CONFIG;
const $ = (id) => document.getElementById(id);
const setText = (id, t) => {
const el = $(id);
if (el) el.textContent = String(t ?? "-");
};

// ===== ethers compatibility layer (v5/v6) =====
const E = window.ethers;

const isEthersV6 = !!E?.BrowserProvider; // v6 has BrowserProvider
const ZERO = isEthersV6 ? E.ZeroAddress : E.constants.AddressZero;

const isAddress = (a) => {
try {
return isEthersV6 ? E.isAddress(a) : E.utils.isAddress(a);
} catch { return false; }
};

const parseUnits = (s, d=18) => {
return isEthersV6 ? E.parseUnits(String(s), d) : E.utils.parseUnits(String(s), d);
};

const formatUnits = (x, d=18) => {
return isEthersV6 ? E.formatUnits(x, d) : E.utils.formatUnits(x, d);
};

const makeProvider = async () => {
if (!window.ethereum) throw new Error("Wallet not found");
if (isEthersV6) {
const p = new E.BrowserProvider(window.ethereum, "any");
await p.send("eth_requestAccounts", []);
return p;
} else {
const p = new E.providers.Web3Provider(window.ethereum, "any");
await p.send("eth_requestAccounts", []);
return p;
}
};

const getSignerAddress = async (provider) => {
if (isEthersV6) {
const s = await provider.getSigner();
return await s.getAddress();
} else {
const s = provider.getSigner();
return await s.getAddress();
}
};

const getSigner = async (provider) => {
return isEthersV6 ? await provider.getSigner() : provider.getSigner();
};

const makeContract = (addr, abi, signerOrProvider) => {
return new E.Contract(addr, abi, signerOrProvider);
};

// ===== UI helpers =====
function toast(msg, type = "ok") {
const el = $("toast");
if (!el) return;
el.classList.remove("show");
el.textContent = msg;
el.style.background = type === "err" ? "#7f1d1d" : "#0b1220";
el.classList.add("show");
setTimeout(() => el.classList.remove("show"), 2400);
}
function setStatus(t) { setText("status", t); }

const shortAddr = (a) => a ? (a.slice(0, 6) + "..." + a.slice(-4)) : "-";

function fmtUnitsNice(x, d=18) {
try {
const n = Number(formatUnits(x, d));
if (!isFinite(n)) return String(x);
return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
} catch { return String(x ?? "-"); }
}
function fmtTS(sec) {
try {
const n = Number(sec || 0);
if (!n) return "-";
return new Date(n * 1000).toLocaleString();
} catch { return "-"; }
}
function pad2(n){ return String(n).padStart(2, "0"); }

// ===== State =====
let provider=null, signer=null, user=null;
let usdt=null, dfToken=null, core=null, vault=null, binary=null;
let stakingV4=null, stakingV5=null;
let usdtDecimals=18, dfDecimals=18;

let selectedPkg = 1; // 1/2/3
let sideRight = false;

// ---- countdown V4 ----
let countdownTimer = null;
let legacyEndSec = 0;
let legacyPrincipal = "0";
let legacyClaimed = false;

const PKG_NAME = ["None", "Small", "Medium", "Large"];
const RANK_NAME = ["None", "Bronze", "Silver", "Gold"];

function stopCountdown(){
if (countdownTimer) clearInterval(countdownTimer);
countdownTimer = null;
}
function setCountdownZeros(){
setText("cdD","0"); setText("cdH","00"); setText("cdM","00"); setText("cdS","00");
}
function startLegacyCountdown() {
stopCountdown();

const tick = () => {
if (!legacyEndSec || legacyEndSec === 0 || legacyPrincipal === "0") {
setCountdownZeros();
setText("stakeEndsAtHint", "No active legacy stake (V4).");
return;
}
if (legacyClaimed) {
setCountdownZeros();
setText("stakeEndsAtHint", "Legacy stake (V4) already claimed ✅");
return;
}

const now = Math.floor(Date.now()/1000);
let diff = legacyEndSec - now;

if (diff <= 0) {
setCountdownZeros();
setText("stakeEndsAtHint", "Legacy stake (V4) matured ✅ You can claim.");
return;
}

const d = Math.floor(diff/86400); diff%=86400;
const h = Math.floor(diff/3600); diff%=3600;
const m = Math.floor(diff/60);
const s = diff%60;

setText("cdD", String(d));
setText("cdH", pad2(h));
setText("cdM", pad2(m));
setText("cdS", pad2(s));
setText("stakeEndsAtHint", `Legacy stake (V4) ends at ${fmtTS(legacyEndSec)}.`);
};

tick();
countdownTimer = setInterval(tick, 1000);
}

async function ensureBSC() {
const net = await provider.getNetwork();
const chainId = Number(net.chainId);
if (chainId === Number(C.CHAIN_ID_DEC)) return true;

try {
// switch
await provider.send("wallet_switchEthereumChain", [{ chainId: C.CHAIN_ID_HEX }]);
return true;
} catch {
// add then switch
await provider.send("wallet_addEthereumChain", [{
chainId: C.CHAIN_ID_HEX,
chainName: C.CHAIN_NAME,
nativeCurrency: { name:"BNB", symbol:"BNB", decimals:18 },
rpcUrls: [C.RPC_URL],
blockExplorerUrls: [C.BLOCK_EXPLORER]
}]);
return true;
}
}

function chooseSide(isRight) {
sideRight = !!isRight;
$("btnSideL")?.classList.toggle("primary", !sideRight);
$("btnSideL")?.classList.toggle("ghost", sideRight);
$("btnSideR")?.classList.toggle("primary", sideRight);
$("btnSideR")?.classList.toggle("ghost", !sideRight);
}

function choosePkg(pkg) {
selectedPkg = Number(pkg);
["pkg1","pkg2","pkg3"].forEach((id, idx) => {
$(id)?.classList.toggle("sel", (idx + 1) === selectedPkg);
});
}

function parseQueryAndApplySponsorLock() {
const q = new URLSearchParams(location.search);
const ref = q.get("ref");
const side = (q.get("side") || "").toUpperCase();

const inp = $("inpSponsor");
const hint = $("sponsorHint");
if (!inp || !hint) return;

if (ref && isAddress(ref)) {
inp.value = ref;
inp.readOnly = true;
inp.style.opacity = "0.95";
hint.textContent = "Sponsor locked from referral link.";
} else {
inp.readOnly = false;
hint.textContent = "If empty, company sponsor will be used.";
}

if (side === "R") chooseSide(true);
if (side === "L") chooseSide(false);
}

function buildReferralLinks() {
if (!user) return;
const base = location.origin + location.pathname.replace(/index\.html$/i, "");
setText("leftLink", `${base}?ref=${user}&side=L`);
setText("rightLink", `${base}?ref=${user}&side=R`);
}

async function copyText(t) {
try { await navigator.clipboard.writeText(t); toast("Copied ✅"); }
catch {
const ta=document.createElement("textarea");
ta.value=t; document.body.appendChild(ta);
ta.select(); document.execCommand("copy");
document.body.removeChild(ta);
toast("Copied ✅");
}
}
async function shareLink(url) {
try {
if (navigator.share) {
await navigator.share({ title:"365DF Referral", text:"Join via my referral link", url });
toast("Shared ✅");
} else {
await copyText(url);
}
} catch {}
}

function pkgUSDTAmount(pkg) {
if (pkg === 1) return parseUnits("100", usdtDecimals);
if (pkg === 2) return parseUnits("1000", usdtDecimals);
return parseUnits("10000", usdtDecimals);
}

// ===== Wiring check (optional but useful) =====
async function checkWiring() {
try {
if (!core || !stakingV5) return;
const coreStaking = await core.STAKING();
const stakingMlm = await stakingV5.mlm?.(); // may not exist in your ABI

let ok1 = true, ok2 = true;
if (coreStaking && C.STAKING_V5) ok1 = coreStaking.toLowerCase() === C.STAKING_V5.toLowerCase();
if (stakingMlm && C.CORE) ok2 = stakingMlm.toLowerCase() === C.CORE.toLowerCase();

if (!ok1 || !ok2) {
setText("dashStatus", "⚠ Config mismatch");
toast("⚠ Config mismatch: stake may not show", "err");
setStatus(
`⚠ Wiring mismatch\n` +
`Core.STAKING=${coreStaking}\nExpected=${C.STAKING_V5}\n` +
(stakingMlm ? `StakingV5.mlm=${stakingMlm}\nExpected=${C.CORE}` : `StakingV5.mlm not in ABI`)
);
}
} catch (e) {
console.error("checkWiring error", e);
}
}

// ===== Refresh blocks =====
async function refreshStakingV4() {
// legacy V4: stakes(user) + pendingReward(user)
try {
if (!stakingV4) return;

// stake info
const s4 = await stakingV4.stakes(user);
// expected: { principal, end, claimed } OR tuple [principal,end,claimed]
const principal = s4.principal ?? s4[0] ?? 0;
const end = s4.end ?? s4[1] ?? 0;
const claimed = s4.claimed ?? s4[2] ?? false;

setText("stakeV4Principal", fmtUnitsNice(principal, dfDecimals));
setText("stakeV4End", fmtTS(end));
setText("stakeV4Claimed", claimed ? "YES" : "NO");

legacyEndSec = Number(end || 0);
legacyClaimed = !!claimed;

// if principal is 0 -> no countdown
const principalNum = Number(formatUnits(principal || 0, dfDecimals));
legacyPrincipal = principalNum > 0 ? String(principalNum) : "0";

// pending reward
try {
const pending = await stakingV4.pendingReward(user);
setText("pendingV4", fmtUnitsNice(pending, dfDecimals));
} catch (e) {
console.error("V4 pendingReward error", e);
setText("pendingV4", "-");
}

startLegacyCountdown();
} catch (e) {
console.error("refreshStakingV4 error", e);
setText("stakeV4Principal", "-");
setText("stakeV4End", "-");
setText("stakeV4Claimed", "-");
setText("pendingV4", "-");
legacyEndSec = 0; legacyPrincipal = "0"; legacyClaimed = false;
startLegacyCountdown();
}
}

async function refreshStakingV5() {
// V5: stakeCount(user) + stakeAt(user,i) + pendingReward(user,i) + pendingRewardTotal(user)
try {
if (!stakingV5) return;

const countBN = await stakingV5.stakeCount(user);
const count = Number(countBN);
setText("stakeV5Count", String(count));

// total pending (if exists)
try {
const totalPending = await stakingV5.pendingRewardTotal?.(user);
if (totalPending != null) setText("pendingV5Total", fmtUnitsNice(totalPending, dfDecimals));
} catch (e) {
console.error("V5 pendingRewardTotal error", e);
setText("pendingV5Total", "-");
}

const wrap = $("v5Slots");
if (wrap) wrap.innerHTML = "";

if (!count || count <= 0) {
if (wrap) wrap.innerHTML = `<div class="muted">No active V5 stake slots.</div>`;
return;
}

let maturedCount = 0;

const now = Math.floor(Date.now() / 1000);

for (let i = 0; i < count; i++) {
// ✅ FIX: must use i (NOT 1)
const lot = await stakingV5.stakeAt(user, i);

// expected fields: pkg, principal, start, end, claimed
const pkg = Number(lot.pkg ?? lot[0] ?? 0);
const principal= lot.principal ?? lot[1] ?? 0;
const start = Number(lot.start ?? lot[2] ?? 0);
const end = Number(lot.end ?? lot[3] ?? 0);
const claimed = !!(lot.claimed ?? lot[4] ?? false);

let pending = 0;
try {
// ✅ FIX: must use i (NOT 1)
pending = await stakingV5.pendingReward(user, i);
} catch (e) {
console.error("V5 pendingReward error (slot " + i + ")", e);
pending = 0;
}

const isMatured = !claimed && end > 0 && now >= end;
if (isMatured) maturedCount++;

if (wrap) {
const div = document.createElement("div");
div.className = "slot";
div.innerHTML = `
<div class="slotHead">
<div><b>Slot #${i}</b> · pkg ${pkg}</div>
<div class="${isMatured ? "ok" : "muted"}">${isMatured ? "MATURED ✅" : (claimed ? "CLAIMED ✅" : "ACTIVE")}</div>
</div>
<div class="grid2">
<div>Principal: <b>${fmtUnitsNice(principal, dfDecimals)}</b></div>
<div>Pending: <b>${fmtUnitsNice(pending, dfDecimals)}</b></div>
<div>Start: ${fmtTS(start)}</div>
<div>End: ${fmtTS(end)}</div>
</div>
`;
wrap.appendChild(div);
}
}

setText("stakeV5Matured", String(maturedCount));
} catch (e) {
console.error("refreshStakingV5 error", e);
setText("stakeV5Count", "-");
setText("pendingV5Total", "-");
setText("stakeV5Matured", "-");
const wrap = $("v5Slots");
if (wrap) wrap.innerHTML = `<div class="muted">V5 read error</div>`;
}
}

async function refreshVault() {
try {
if (!vault) return;

// if your vault has these view methods, show them
// (keep safe: if missing -> ignore)
const safeCall = async (fn, id, dec=18) => {
try {
const v = await fn();
setText(id, fmtUnitsNice(v, dec));
} catch (e) {
// only log if needed
// console.error("vault read err", e);
setText(id, "-");
}
};

// Common ones you showed in BscScan: surplusUSDT(), surplusDF(), totalClaimableUSDT(), ...
await safeCall(() => vault.surplusUSDT?.(), "vaultSurplusUSDT", usdtDecimals);
await safeCall(() => vault.surplusDF?.(), "vaultSurplusDF", dfDecimals);

await safeCall(() => vault.totalClaimableUSDT?.(), "vaultClaimableUSDT", usdtDecimals);
await safeCall(() => vault.totalClaimableDF?.(), "vaultClaimableDF", dfDecimals);

await safeCall(() => vault.totalLockedUSDT?.(), "vaultLockedUSDT", usdtDecimals);
await safeCall(() => vault.totalLockedDF?.(), "vaultLockedDF", dfDecimals);

await safeCall(() => vault.totalUnlockedUSDT?.(), "vaultUnlockedUSDT", usdtDecimals);
await safeCall(() => vault.totalUnlockedDF?.(), "vaultUnlockedDF", dfDecimals);

await safeCall(() => vault.totalClaimedUSDT?.(), "vaultClaimedUSDT", usdtDecimals);
await safeCall(() => vault.totalClaimedDF?.(), "vaultClaimedDF", dfDecimals);

} catch (e) {
console.error("refreshVault error", e);
}
}

async function refreshAll(showToast=false) {
if (!user) return;

try {
setText("dashStatus", "Refreshing...");
setStatus("Refreshing...");

// Core users()
try {
const u = await core.users(user);
const pkgId = Number(u.pkg ?? u[3] ?? 0);
const rankId = Number(u.rank ?? u[4] ?? 0);
const sponsor = u.sponsor ?? u[0] ?? ZERO;

setText("myPkg", PKG_NAME[pkgId] || "-");
setText("myRank", RANK_NAME[rankId] || "-");
setText("mySponsor", sponsor && sponsor !== ZERO ? shortAddr(sponsor) : "0x0000...0000");
setText("myDirects", String(u.directSmallOrMore ?? u[5] ?? "-"));
} catch (e) {
console.error("core.users read error", e);
setText("myPkg", "-");
setText("myRank", "-");
setText("mySponsor", "-");
setText("myDirects", "-");
}

// Binary volumes
try {
const vols = await binary.volumesOf(user);
setText("volL", fmtUnitsNice(vols.l ?? vols[0] ?? 0, dfDecimals));
setText("volR", fmtUnitsNice(vols.r ?? vols[1] ?? 0, dfDecimals));
setText("volP", fmtUnitsNice(vols.p ?? vols[2] ?? 0, dfDecimals));
} catch (e) {
console.error("binary.volumesOf error", e);
setText("volL", "-");
setText("volR", "-");
setText("volP", "-");
}

await refreshStakingV4();
await refreshStakingV5();
await refreshVault();

setText("dashStatus", "Updated ✅");
setStatus("Updated ✅");
if (showToast) toast("Updated ✅");
} catch (e) {
console.error(e);
setText("dashStatus", "Error");
setStatus("Refresh error: " + (e?.message || String(e)));
if (showToast) toast("Refresh failed", "err");
}
}

// ===== Actions (Buy/Upgrade) =====
async function buyOrUpgrade() {
try {
if (!core || !usdt) throw new Error("Not connected");

const sponsorInp = $("inpSponsor");
const sponsor = sponsorInp?.value?.trim();
const sponsorAddr = sponsor && isAddress(sponsor) ? sponsor : ZERO;

// placementParent: optional (0 means sponsor/root logic in core)
const placementInp = $("inpPlacement");
const placement = placementInp?.value?.trim();
const placementAddr = placement && isAddress(placement) ? placement : ZERO;

const pkg = Number(selectedPkg); // 1/2/3 => Small/Medium/Large

const usdtAmt = pkgUSDTAmount(pkg);

// approve if needed
const allowance = await usdt.allowance(user, C.CORE);
if (allowance < usdtAmt) {
setStatus("Approving USDT...");
toast("Approving USDT...", "ok");
const txa = await usdt.approve(C.CORE, usdtAmt);
await txa.wait?.();
}

setStatus("Sending buy/upgrade tx...");
toast("Sending tx...", "ok");

const tx = await core.buyOrUpgrade(pkg, sponsorAddr, placementAddr, !!sideRight);
await tx.wait?.();

toast("Success ✅");
setStatus("Success ✅");
await refreshAll(true);

} catch (e) {
console.error("buyOrUpgrade error", e);
toast(e?.reason || e?.message || "Tx failed", "err");
setStatus("Tx failed: " + (e?.reason || e?.message || String(e)));
}
}

// ===== Connect =====
async function connect() {
try {
provider = await makeProvider();
signer = await getSigner(provider);
user = await getSignerAddress(provider);

await ensureBSC();

usdt = makeContract(C.USDT, C.ERC20_ABI, signer);
dfToken = makeContract(C.DF, C.ERC20_ABI, signer);

core = makeContract(C.CORE, C.CORE_ABI, signer);
vault = makeContract(C.VAULT, C.VAULT_ABI, signer);
binary = makeContract(C.BINARY, C.BINARY_ABI, signer);

stakingV4 = makeContract(C.STAKING_V4, C.STAKING_V4_ABI, signer);
stakingV5 = makeContract(C.STAKING_V5, C.STAKING_V5_ABI, signer);

try { usdtDecimals = Number(await usdt.decimals()); } catch { usdtDecimals = 18; }
try { dfDecimals = Number(await dfToken.decimals()); } catch { dfDecimals = 18; }

setText("walletAddr", shortAddr(user));
setText("netText", "BSC (56)");

const btn = $("btnConnect");
if (btn) {
btn.textContent = "Connected";
btn.disabled = true;
}

// addresses in UI (if exist)
setText("coreAddr", C.CORE);
setText("vaultAddr", C.VAULT);
setText("binaryAddr", C.BINARY);
setText("stakingV4Addr", C.STAKING_V4);
setText("stakingV5Addr", C.STAKING_V5);
setText("usdtAddr", C.USDT);
setText("dfAddr", C.DF);

buildReferralLinks();
await refreshAll(true);
await checkWiring();

window.ethereum?.on?.("accountsChanged", () => location.reload());
window.ethereum?.on?.("chainChanged", () => location.reload());

toast("Connected ✅");
setStatus("Ready.");
} catch (e) {
console.error("connect error", e);
toast("Connect failed", "err");
setStatus("Connect error: " + (e?.message || String(e)));
}
}

// ===== Bind UI =====
function bindUI() {
$("btnConnect")?.addEventListener("click", connect);

$("pkg1")?.addEventListener("click", () => choosePkg(1));
$("pkg2")?.addEventListener("click", () => choosePkg(2));
$("pkg3")?.addEventListener("click", () => choosePkg(3));

$("btnSideL")?.addEventListener("click", () => chooseSide(false));
$("btnSideR")?.addEventListener("click", () => chooseSide(true));

$("btnRefresh")?.addEventListener("click", () => refreshAll(true));
$("btnBuy")?.addEventListener("click", buyOrUpgrade);

$("btnCopyL")?.addEventListener("click", () => copyText($("leftLink")?.textContent || ""));
$("btnCopyR")?.addEventListener("click", () => copyText($("rightLink")?.textContent || ""));
$("btnShareL")?.addEventListener("click", () => shareLink($("leftLink")?.textContent || ""));
$("btnShareR")?.addEventListener("click", () => shareLink($("rightLink")?.textContent || ""));
}

// ===== Init =====
function init() {
bindUI();
parseQueryAndApplySponsorLock();
choosePkg(1);
chooseSide(false);
setCountdownZeros();
setStatus("Please connect wallet.");
}

init();
})();

ถึง
