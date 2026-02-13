// app.js
;(() => {
  "use strict";
  const C = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);

  const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  const shortAddr = (a) => a ? (a.slice(0, 6) + "..." + a.slice(-4)) : "-";

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

  let provider=null, signer=null, user=null;

  let usdt=null, dfToken=null;
  let core=null, vault=null, binary=null;

  let staking5=null;  // new
  let staking4=null;  // legacy

  let usdtDecimals=18, dfDecimals=18;

  let selectedPkg = 1;   // 1/2/3
  let sideRight = false; // false=L true=R

  // Countdown (nearest active lot from StakingV5, or fallback to V4)
  let countdownTimer = null;
  let nearestEndSec = 0;
  let nearestLabel = "-";

  const PKG_NAME_CORE = ["None", "Small", "Medium", "Large"];
  const RANK_NAME = ["None", "Bronze", "Silver", "Gold"];

  const PKG_NAME_STAKE = ["Small", "Medium", "Large"];

  function fmtUnits(x, d=18) {
    try { return Number(ethers.utils.formatUnits(x, d)).toLocaleString(undefined, { maximumFractionDigits: 6 }); }
    catch { return String(x); }
  }

  function fmtTS(sec) {
    try{
      const n = Number(sec || 0);
      if (!n) return "-";
      return new Date(n * 1000).toLocaleString();
    } catch { return "-"; }
  }

  function pad2(n){ return String(n).padStart(2, "0"); }

  function stopCountdown(){
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
  }

  function setCountdownZeros() {
    setText("cdD", "0");
    setText("cdH", "00");
    setText("cdM", "00");
    setText("cdS", "00");
  }

  function startCountdown() {
    stopCountdown();

    const tick = () => {
      if (!nearestEndSec || nearestEndSec === 0) {
        setCountdownZeros();
        setText("stakeEndsAtHint", "No active stake.");
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      let diff = nearestEndSec - now;

      if (diff <= 0) {
        setCountdownZeros();
        setText("stakeEndsAtHint", `Matured ✅ (${nearestLabel}). You can claim.`);
        return;
      }

      const d = Math.floor(diff / 86400);
      diff %= 86400;
      const h = Math.floor(diff / 3600);
      diff %= 3600;
      const m = Math.floor(diff / 60);
      const s = diff % 60;

      setText("cdD", String(d));
      setText("cdH", pad2(h));
      setText("cdM", pad2(m));
      setText("cdS", pad2(s));
      setText("stakeEndsAtHint", `${nearestLabel} ends at ${fmtTS(nearestEndSec)}.`);
    };

    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  async function ensureBSC() {
    const net = await provider.getNetwork();
    if (net.chainId === C.CHAIN_ID_DEC) return true;

    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: C.CHAIN_ID_HEX }]);
      return true;
    } catch (e) {
      await provider.send("wallet_addEthereumChain", [{
        chainId: C.CHAIN_ID_HEX,
        chainName: C.CHAIN_NAME,
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
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

    if (ref && ethers.utils.isAddress(ref)) {
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
    const left = `${base}?ref=${user}&side=L`;
    const right = `${base}?ref=${user}&side=R`;
    setText("leftLink", left);
    setText("rightLink", right);
  }

  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t);
      toast("Copied ✅");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast("Copied ✅");
    }
  }

  async function shareLink(url) {
    try {
      if (navigator.share) {
        await navigator.share({ title: "365DF Referral", text: "Join via my referral link", url });
        toast("Shared ✅");
      } else {
        await copyText(url);
      }
    } catch {}
  }

  function pkgUSDTAmount(pkg) {
    if (pkg === 1) return ethers.utils.parseUnits("100", usdtDecimals);
    if (pkg === 2) return ethers.utils.parseUnits("1000", usdtDecimals);
    return ethers.utils.parseUnits("10000", usdtDecimals);
  }

  async function connect() {
    try {
      if (!window.ethereum) {
        alert("Wallet not found. Please open this site in Bitget/MetaMask DApp Browser.");
        return;
      }

      provider = new ethers.providers.Web3Provider(window.ethereum, "any");
      await provider.send("eth_requestAccounts", []);
      signer = provider.getSigner();
      user = await signer.getAddress();

      await ensureBSC();

      usdt    = new ethers.Contract(C.USDT, C.ERC20_ABI, signer);
      dfToken = new ethers.Contract(C.DF,   C.ERC20_ABI, signer);

      core    = new ethers.Contract(C.CORE,   C.CORE_ABI,   signer);
      vault   = new ethers.Contract(C.VAULT,  C.VAULT_ABI,  signer);
      binary  = new ethers.Contract(C.BINARY, C.BINARY_ABI, signer);

      staking5 = new ethers.Contract(C.STAKING5, C.STAKING5_ABI, signer);
      staking4 = new ethers.Contract(C.STAKING4, C.STAKING4_ABI, signer);

      try { usdtDecimals = await usdt.decimals(); } catch { usdtDecimals = 18; }
      try { dfDecimals = await dfToken.decimals(); } catch { dfDecimals = 18; }

      setText("walletAddr", shortAddr(user));
      setText("netText", "bnb (56)");
      $("btnConnect").textContent = "Connected";
      $("btnConnect").disabled = true;

      setText("coreAddr", C.CORE);
      setText("vaultAddr", C.VAULT);
      setText("binaryAddr", C.BINARY);
      setText("usdtAddr", C.USDT);
      setText("dfAddr", C.DF);

      setText("staking5Addr", C.STAKING5);
      setText("staking4Addr", C.STAKING4);
      setText("defaultSponsor", C.DEFAULT_SPONSOR);

      buildReferralLinks();
      await refreshAll(true);

      window.ethereum.on?.("accountsChanged", () => location.reload());
      window.ethereum.on?.("chainChanged", () => location.reload());

      toast("Connected ✅");
    } catch (e) {
      console.error(e);
      toast("Connect failed", "err");
      setStatus("Connect error: " + (e?.message || String(e)));
    }
  }

  function renderStakeLots(rows) {
    const tb = $("stakeLots");
    if (!tb) return;
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="8" class="muted">No lots found.</td></tr>`;
      return;
    }
    tb.innerHTML = rows.join("");
  }

  function safeNum(x){ try { return Number(x); } catch { return 0; } }

  async function refreshStakingV5() {
    // default
    setText("staking5Count", "-");
    setText("staking5PendingTotal", "-");
    setText("staking5ContractBal", "-");
    renderStakeLots([]);

    let count = 0;
    try { count = safeNum(await staking5.stakeCount(user)); } catch { count = 0; }
    setText("staking5Count", String(count));

    // pending total
    try {
      const pt = await staking5.pendingRewardTotal(user);
      setText("staking5PendingTotal", fmtUnits(pt, dfDecimals));
    } catch {
      setText("staking5PendingTotal", "-");
    }

    // contract DF balance (useful to know if claims can pay)
    try {
      const b = await staking5.contractDFBalance();
      setText("staking5ContractBal", fmtUnits(b, dfDecimals));
    } catch {
      setText("staking5ContractBal", "-");
    }

    // list lots (cap to avoid heavy UI)
    const MAX_UI_LOTS = 60;
    const n = Math.min(count, MAX_UI_LOTS);

    let nearest = { end: 0, label: "-", isSet:false };

    const rows = [];
    for (let i = 0; i < n; i++) {
      let lot, pend;
      try {
        lot = await staking5.stakeAt(user, i);
      } catch {
        continue;
      }

      try {
        pend = await staking5.pendingReward(user, i);
      } catch {
        pend = ethers.constants.Zero;
      }

      const pkg = safeNum(lot.pkg);
      const principal = lot.principal || ethers.constants.Zero;
      const start = safeNum(lot.start);
      const end = safeNum(lot.end);
      const claimed = !!lot.claimed;

      // nearest active (unclaimed) end time
      if (!claimed && principal.gt(0) && end > 0) {
        if (!nearest.isSet || end < nearest.end) {
          nearest = { end, label: `StakingV5 Lot #${i}`, isSet:true };
        }
      }

      const canClaim = (!claimed && end > 0 && Math.floor(Date.now()/1000) >= end);

      rows.push(`
        <tr>
          <td class="mono">${i}</td>
          <td>${PKG_NAME_STAKE[pkg] || String(pkg)}</td>
          <td class="mono">${fmtUnits(principal, dfDecimals)}</td>
          <td class="mono">${fmtTS(start)}</td>
          <td class="mono">${fmtTS(end)}</td>
          <td class="mono">${claimed ? "YES" : "NO"}</td>
          <td class="mono">${fmtUnits(pend, dfDecimals)}</td>
          <td>
            <button class="btn ${canClaim ? "primary" : ""}" data-claim5="${i}" ${canClaim ? "" : "disabled"}>
              Claim
            </button>
          </td>
        </tr>
      `);
    }

    renderStakeLots(rows);

    // Set global countdown target from V5 if exists
    if (nearest.isSet) {
      nearestEndSec = nearest.end;
      nearestLabel = nearest.label;
      startCountdown();
      return true;
    }
    return false;
  }

  async function refreshStakingV4AndMaybeSetCountdownFallback() {
    // Legacy V4 view
    try {
      const p = await staking4.pendingReward(user);
      setText("pendingStakeV4", fmtUnits(p, dfDecimals));
    } catch {
      setText("pendingStakeV4", "-");
    }

    try {
      const s = await staking4.stakes(user);
      setText("stakePrincipalV4", fmtUnits(s.principal || 0, dfDecimals));
      setText("stakeEndV4", fmtTS(s.end));
      setText("stakeClaimedV4", s.claimed ? "YES" : "NO");

      // fallback countdown only if V5 has no active
      const principal = s.principal || ethers.constants.Zero;
      const end = safeNum(s.end);
      const claimed = !!s.claimed;
      if (nearestEndSec === 0 && !claimed && principal.gt(0) && end > 0) {
        nearestEndSec = end;
        nearestLabel = "Legacy StakingV4";
        startCountdown();
      }
    } catch {
      setText("stakePrincipalV4", "-");
      setText("stakeEndV4", "-");
      setText("stakeClaimedV4", "-");
    }
  }

  async function refreshAll(showToast=false) {
    if (!user) return;
    try {
      setText("dashStatus", "Refreshing...");
      setStatus("Refreshing...");

      // Core users()
      const u = await core.users(user);
      const pkg = Number(u.pkg);
      const rank = Number(u.rank);

      setText("myPkg", PKG_NAME_CORE[pkg] || "-");
      setText("myRank", RANK_NAME[rank] || "-");
      setText("mySponsor", (u.sponsor && u.sponsor !== ethers.constants.AddressZero) ? shortAddr(u.sponsor) : "0x0000...0000");

      // Binary volumes
      const vols = await binary.volumesOf(user);
      setText("volL", fmtUnits(vols.l, dfDecimals));
      setText("volR", fmtUnits(vols.r, dfDecimals));
      setText("volP", fmtUnits(vols.p, dfDecimals));

      // Countdown reset
      nearestEndSec = 0;
      nearestLabel = "-";
      stopCountdown();
      setCountdownZeros();
      setText("stakeEndsAtHint", "-");

      // Staking V5 first (primary)
      await refreshStakingV5();

      // Then legacy V4 viewer (and fallback countdown if needed)
      await refreshStakingV4AndMaybeSetCountdownFallback();

      // Vault
      const cU = await vault.claimableUSDT(user);
      setText("vClaimableUSDT", fmtUnits(cU, usdtDecimals));

      const e = await vault.earns(user);
      setText("vUnlockedUSDT", fmtUnits(e.unlockedUSDT, usdtDecimals));
      setText("vClaimedUSDT", fmtUnits(e.claimedUSDT, usdtDecimals));
      setText("vLockedUSDT", fmtUnits(e.lockedUSDT, usdtDecimals));
      setText("vLockStartUSDT", fmtTS(e.lockStartUSDT));
      setText("vLockEndUSDT", fmtTS(e.lockEndUSDT));

      // warning
      const warnEl = $("vaultWarn");
      if (warnEl) {
        const now = Math.floor(Date.now()/1000);
        const end = Number(e.lockEndUSDT || 0);
        if (Number(e.lockedUSDT || 0) > 0 && end > 0) {
          warnEl.textContent = (now > end)
            ? "⚠️ Locked has expired (past 90 days). It may be counted as expired per contract rules."
            : "ℹ️ Locked exists. It will unlock when your cap increases via buy/upgrade. Use Refresh/Claim per contract rules.";
        } else {
          warnEl.textContent = "ℹ️ If you have Locked rewards, they will unlock when your cap increases via buy/upgrade. Use Refresh/Claim per contract rules.";
        }
      }

      setText("dashStatus", "Updated ✅");
      setStatus("Updated ✅");
      if (showToast) toast("Refreshed ✅");
    } catch (e) {
      console.error(e);
      toast("Refresh failed", "err");
      setStatus("Refresh error: " + (e?.message || String(e)));
      setText("dashStatus", "Refresh error");
    }
  }

  async function approveUSDT() {
    if (!user) return alert("Please connect wallet first.");
    try {
      const amt = pkgUSDTAmount(selectedPkg);
      setText("buyStatus", "Approving USDT...");
      setStatus("Approving USDT...");

      const tx = await usdt.approve(C.CORE, amt);
      await tx.wait();

      setText("buyStatus", "Approve success ✅");
      setStatus("Approve success ✅");
      toast("Approve success ✅");
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      setText("buyStatus", "Approve error: " + msg);
      setStatus("Approve error: " + msg);
      toast("Approve failed", "err");
    }
  }

  async function buyOrUpgrade() {
    if (!user) return alert("Please connect wallet first.");
    try {
      let sponsor = ($("inpSponsor").value || "").trim();
      let placement = ($("inpPlacement").value || "").trim();

      if (!sponsor) sponsor = C.DEFAULT_SPONSOR;
      if (!placement) placement = sponsor;

      if (!ethers.utils.isAddress(sponsor)) {
        toast("Invalid sponsor address", "err");
        return;
      }
      if (!ethers.utils.isAddress(placement)) {
        toast("Invalid placement address", "err");
        return;
      }

      setText("buyStatus", "Sending transaction...");
      setStatus("Sending buyOrUpgrade...");

      const tx = await core.buyOrUpgrade(selectedPkg, sponsor, placement, sideRight);
      await tx.wait();

      setText("buyStatus", "Buy/Upgrade success ✅");
      setStatus("Buy/Upgrade success ✅");
      toast("Buy/Upgrade success ✅");

      await refreshAll(true);
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      setText("buyStatus", "Buy error: " + msg);
      setStatus("Buy error: " + msg);
      toast("Buy failed", "err");
    }
  }

  async function claimStakeV5(stakeId) {
    if (!user) return alert("Please connect wallet first.");
    try {
      setStatus(`Claiming StakingV5 lot #${stakeId}...`);
      const tx = await staking5.claimStake(stakeId, { gasLimit: 450000 });
      await tx.wait();
      toast(`Claimed lot #${stakeId} ✅`);
      await refreshAll(true);
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      setStatus("Claim V5 error: " + msg);
      toast("Claim failed", "err");
    }
  }

  async function claimAllMatured() {
    if (!user) return alert("Please connect wallet first.");
    try {
      const v = ($("inpMaxClaims")?.value || "10").trim();
      const maxClaims = Math.max(1, Math.min(100, Number(v || 10)));

      setStatus(`Claiming all matured (maxClaims=${maxClaims})...`);
      const tx = await staking5.claimAllMatured(maxClaims, { gasLimit: 700000 });
      await tx.wait();
      toast("Claimed matured lots ✅");
      await refreshAll(true);
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      setStatus("ClaimAll error: " + msg);
      toast("ClaimAll failed", "err");
    }
  }

  async function claimStakeV4() {
    if (!user) return alert("Please connect wallet first.");
    try {
      setStatus("Claiming legacy stake (V4)...");
      const tx = await staking4.claimStake({ gasLimit: 450000 });
      await tx.wait();
      toast("Claimed legacy stake ✅");
      await refreshAll(true);
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      setStatus("Claim V4 error: " + msg);
      toast("Legacy claim failed", "err");
    }
  }

  async function vaultRefresh() {
    if (!user) return alert("Please connect wallet first.");
    try {
      setText("vaultStatus", "Refreshing vault...");
      setStatus("Refreshing vault...");

      const tx = await vault.refresh(user, { gasLimit: 350000 });
      await tx.wait();

      setText("vaultStatus", "Vault refreshed ✅");
      setStatus("Vault refreshed ✅");
      toast("Vault refreshed ✅");
      await refreshAll(true);
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      setText("vaultStatus", "Refresh error: " + msg);
      setStatus("Vault refresh error: " + msg);
      toast("Vault refresh failed", "err");
    }
  }

  async function claimVault() {
    if (!user) return alert("Please connect wallet first.");
    try {
      setStatus("Checking claimable...");
      const cU = await vault.claimableUSDT(user);
      const cD = await vault.claimableDF(user);

      const hasU = cU && cU.gt(0);
      const hasD = cD && cD.gt(0);

      if (!hasU && !hasD) {
        setStatus("Nothing to claim (claimable = 0).");
        toast("Nothing to claim", "err");
        return;
      }

      setText("vaultStatus", "Claiming vault...");
      setStatus("Claiming vault...");

      const tx = await vault.claim({ gasLimit: 350000 });
      await tx.wait();

      setText("vaultStatus", "Claim success ✅");
      setStatus("Claim success ✅");
      toast("Claim success ✅");
      await refreshAll(true);
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      setText("vaultStatus", "Claim error: " + msg);
      setStatus("Claim Vault error: " + msg);
      toast("Claim Vault failed", "err");
    }
  }

  async function addTokens() {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: C.DF, symbol: "365DF", decimals: Number(dfDecimals || 18) } }
      });
      await window.ethereum.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: C.USDT, symbol: "USDT", decimals: Number(usdtDecimals || 18) } }
      });
      toast("Tokens added ✅");
    } catch {
      toast("Add token canceled", "err");
    }
  }

  function bindUI() {
    $("btnConnect").onclick = connect;
    $("btnRefresh").onclick = () => refreshAll(true);
    $("btnAddTokens").onclick = addTokens;

    $("btnSideL").onclick = () => chooseSide(false);
    $("btnSideR").onclick = () => chooseSide(true);
    chooseSide(false);

    document.querySelectorAll(".pkg").forEach(btn => {
      btn.onclick = () => choosePkg(btn.dataset.pkg);
    });
    choosePkg(1);

    $("btnApprove").onclick = approveUSDT;
    $("btnBuy").onclick = buyOrUpgrade;

    $("btnVaultRefresh").onclick = vaultRefresh;
    $("btnClaimVault").onclick = claimVault;

    $("btnClaimAllMatured").onclick = claimAllMatured;
    $("btnClaimStakeV4").onclick = claimStakeV4;

    $("btnCopyLeft").onclick = async () => {
      const t = $("leftLink").textContent;
      if (t && t !== "-") await copyText(t);
    };
    $("btnCopyRight").onclick = async () => {
      const t = $("rightLink").textContent;
      if (t && t !== "-") await copyText(t);
    };
    $("btnShareLeft").onclick = async () => {
      const url = $("leftLink").textContent;
      if (url && url !== "-") await shareLink(url);
    };
    $("btnShareRight").onclick = async () => {
      const url = $("rightLink").textContent;
      if (url && url !== "-") await shareLink(url);
    };

    // Delegated click for Claim buttons in table
    document.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("[data-claim5]");
      if (!btn) return;
      const id = Number(btn.getAttribute("data-claim5"));
      if (Number.isFinite(id)) await claimStakeV5(id);
    });
  }

  function initStatic() {
    setText("coreAddr", C.CORE);
    setText("vaultAddr", C.VAULT);
    setText("binaryAddr", C.BINARY);
    setText("usdtAddr", C.USDT);
    setText("dfAddr", C.DF);

    setText("staking5Addr", C.STAKING5);
    setText("staking4Addr", C.STAKING4);
    setText("defaultSponsor", C.DEFAULT_SPONSOR);

    setText("walletAddr", "-");
    setText("netText", "-");
    setText("buyStatus", "Ready.");
    setText("dashStatus", "-");
    setText("vaultStatus", "-");

    setCountdownZeros();
    setText("stakeEndsAtHint", "-");

    setText("staking5Count", "-");
    setText("staking5PendingTotal", "-");
    setText("staking5ContractBal", "-");

    setText("pendingStakeV4", "-");
    setText("stakePrincipalV4", "-");
    setText("stakeEndV4", "-");
    setText("stakeClaimedV4", "-");

    renderStakeLots([]);
    setStatus("Ready.");
  }

  window.addEventListener("load", () => {
    initStatic();
    bindUI();
    parseQueryAndApplySponsorLock();
  });
})();
