// app.js
;(() => {
  "use strict";
  const C = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);

  const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
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
  let usdt=null, core=null, vault=null, binary=null;
  let stakingV4=null, stakingV5=null;

  let usdtDecimals=18, dfDecimals=18;

  let selectedPkg = 1;   // 1/2/3
  let sideRight = false; // false=L true=R

  // ---- countdown for legacy (V4) ----
  let countdownTimer = null;
  let legacyEndSec = 0;
  let legacyPrincipal = "0";
  let legacyClaimed = false;

  const PKG_NAME = ["None", "Small", "Medium", "Large"];
  const RANK_NAME = ["None", "Bronze", "Silver", "Gold"];

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

      const now = Math.floor(Date.now() / 1000);
      let diff = legacyEndSec - now;

      if (diff <= 0) {
        setCountdownZeros();
        setText("stakeEndsAtHint", "Legacy stake (V4) matured ✅ You can claim.");
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
      setText("stakeEndsAtHint", `Legacy stake (V4) ends at ${fmtTS(legacyEndSec)}.`);
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

  function esc(s){
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
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

      // contracts
      usdt = new ethers.Contract(C.USDT, C.ERC20_ABI, signer);
      const dfToken = new ethers.Contract(C.DF, C.ERC20_ABI, signer);

      core   = new ethers.Contract(C.CORE,   C.CORE_ABI,   signer);
      vault  = new ethers.Contract(C.VAULT,  C.VAULT_ABI,  signer);
      binary = new ethers.Contract(C.BINARY, C.BINARY_ABI, signer);

      stakingV4 = new ethers.Contract(C.STAKING_V4, C.STAKING_V4_ABI, signer);
      stakingV5 = new ethers.Contract(C.STAKING_V5, C.STAKING_V5_ABI, signer);

      try { usdtDecimals = await usdt.decimals(); } catch { usdtDecimals = 18; }
      try { dfDecimals = await dfToken.decimals(); } catch { dfDecimals = 18; }

      setText("walletAddr", shortAddr(user));
      setText("netText", "bnb (56)");
      $("btnConnect").textContent = "Connected";
      $("btnConnect").disabled = true;

      setText("coreAddr", C.CORE);
      setText("vaultAddr", C.VAULT);
      setText("binaryAddr", C.BINARY);
      setText("stakingV4Addr", C.STAKING_V4);
      setText("stakingV5Addr", C.STAKING_V5);
      setText("usdtAddr", C.USDT);
      setText("dfAddr", C.DF);

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

  async function refreshAll(showToast=false) {
    if (!user) return;
    try {
      setText("dashStatus", "Refreshing...");
      setStatus("Refreshing...");

      // Core users()
      const u = await core.users(user);
      const pkg = Number(u.pkg);
      const rank = Number(u.rank);

      setText("myPkg", PKG_NAME[pkg] || "-");
      setText("myRank", RANK_NAME[rank] || "-");
      setText("mySponsor", (u.sponsor && u.sponsor !== ethers.constants.AddressZero) ? shortAddr(u.sponsor) : "0x0000...0000");

      // Binary volumes
      const vols = await binary.volumesOf(user);
      setText("volL", fmtUnits(vols.l, dfDecimals));
      setText("volR", fmtUnits(vols.r, dfDecimals));
      setText("volP", fmtUnits(vols.p, dfDecimals));

      // ===== Legacy Staking (V4) =====
      let v4Pending = "0";
      try {
        const pending4 = await stakingV4.pendingReward(user);
        v4Pending = fmtUnits(pending4, dfDecimals);
        setText("pendingStakeV4", v4Pending);

        const s4 = await stakingV4.stakes(user);
        setText("stakeV4Principal", fmtUnits(s4.principal, dfDecimals));
        setText("stakeV4End", fmtTS(s4.end));
        setText("stakeV4Claimed", s4.claimed ? "YES" : "NO");

        legacyEndSec = Number(s4.end || 0);
        legacyClaimed = !!s4.claimed;
        legacyPrincipal = (s4.principal ? s4.principal.toString() : "0");
        startLegacyCountdown();
      } catch (e) {
        setText("pendingStakeV4", "-");
        setText("stakeV4Principal", "-");
        setText("stakeV4End", "-");
        setText("stakeV4Claimed", "-");
        legacyEndSec = 0; legacyPrincipal = "0"; legacyClaimed = false;
        startLegacyCountdown();
      }

      // ===== New Staking (V5) multi-lot =====
      try {
        const countBN = await stakingV5.stakeCount(user);
        const count = Number(countBN.toString());
        setText("stakeV5Count", String(count));

        const totalPendingBN = await stakingV5.pendingRewardTotal(user);
        setText("pendingStakeV5Total", fmtUnits(totalPendingBN, dfDecimals));

        const maxShow = Math.min(count, 30); // safety for mobile
        const rows = [];
        let maturedNotClaimed = 0;

        for (let i = 0; i < maxShow; i++) {
          const lot = await stakingV5.stakeAt(user, i);
          const pend = await stakingV5.pendingReward(user, i);

          const endSec = Number(lot.end || 0);
          const now = Math.floor(Date.now()/1000);
          const matured = endSec > 0 && now >= endSec;
          const claimed = !!lot.claimed;

          if (matured && !claimed) maturedNotClaimed++;

          rows.push(`
            <div class="lotRow">
              <div class="lotHead">
                <div class="mono">#${i}</div>
                <div class="pill ${claimed ? "okPill" : (matured ? "warnPill" : "")}">
                  ${claimed ? "CLAIMED" : (matured ? "MATURED" : "RUNNING")}
                </div>
              </div>
              <div class="kv"><span>Package</span><span class="mono">${PKG_NAME[Number(lot.pkg)+1] || String(lot.pkg)}</span></div>
              <div class="kv"><span>Principal</span><span class="mono">${fmtUnits(lot.principal, dfDecimals)}</span></div>
              <div class="kv"><span>End</span><span class="mono">${fmtTS(lot.end)}</span></div>
              <div class="kv"><span>Pending</span><span class="mono">${fmtUnits(pend, dfDecimals)}</span></div>
            </div>
          `);
        }

        setText("stakeV5Matured", String(maturedNotClaimed));
        setHTML("v5Lots", rows.length ? rows.join("") : `<div class="hint">No stakes in V5.</div>`);
        if (count > maxShow) {
          setHTML("v5Lots", rows.join("") + `<div class="hint">Showing first ${maxShow} lots only (mobile safe).</div>`);
        }
      } catch (e) {
        setText("stakeV5Count", "-");
        setText("stakeV5Matured", "-");
        setText("pendingStakeV5Total", "-");
        setHTML("v5Lots", `<div class="hint">Unable to read V5 lots.</div>`);
      }

      // Vault
      const cU = await vault.claimableUSDT(user);
      setText("vClaimableUSDT", fmtUnits(cU, usdtDecimals));

      const e = await vault.earns(user);
      setText("vUnlockedUSDT", fmtUnits(e.unlockedUSDT, usdtDecimals));
      setText("vClaimedUSDT", fmtUnits(e.claimedUSDT, usdtDecimals));
      setText("vLockedUSDT", fmtUnits(e.lockedUSDT, usdtDecimals));
      setText("vLockStartUSDT", fmtTS(e.lockStartUSDT));
      setText("vLockEndUSDT", fmtTS(e.lockEndUSDT));

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

      // ✅ IMPORTANT FIX:
      // If Placement is empty, send AddressZero so CoreV6 can auto-find empty slot (BFS).
      if (!placement) placement = ethers.constants.AddressZero;

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

  // ===== Legacy claim (V4) =====
  async function claimStakeV4() {
    if (!user) return alert("Please connect wallet first.");
    try {
      setStatus("Claiming legacy stake (V4)...");
      const tx = await stakingV4.claimStake({ gasLimit: 450000 });
      await tx.wait();
      toast("Claim V4 success ✅");
      await refreshAll(true);
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      setStatus("Claim V4 error: " + msg);
      toast("Claim V4 failed", "err");
    }
  }

  // ===== New claim (V5) =====
  async function claimStakeV5ById() {
    if (!user) return alert("Please connect wallet first.");
    try {
      const idStr = ($("inpClaimId")?.value || "").trim();
      if (!idStr) return toast("Enter stakeId", "err");
      const stakeId = ethers.BigNumber.from(idStr).toString();

      setStatus(`Claiming V5 stake #${stakeId}...`);
      const tx = await stakingV5.claimStake(stakeId, { gasLimit: 650000 });
      await tx.wait();
      toast(`Claim V5 #${stakeId} success ✅`);
      await refreshAll(true);
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      setStatus("Claim V5 error: " + msg);
      toast("Claim V5 failed", "err");
    }
  }

  async function claimAllMaturedV5() {
    if (!user) return alert("Please connect wallet first.");
    try {
      const maxStr = ($("inpMaxClaims")?.value || "").trim() || "10";
      const maxClaims = ethers.BigNumber.from(maxStr).toString();

      setStatus(`Claiming all matured (max ${maxClaims})...`);
      const tx = await stakingV5.claimAllMatured(maxClaims, { gasLimit: 900000 });
      await tx.wait();
      toast("Claim All Matured success ✅");
      await refreshAll(true);
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      setStatus("Claim All Matured error: " + msg);
      toast("Claim All Matured failed", "err");
    }
  }

  async function vaultRefresh() {
    if (!user) return alert("Please connect wallet first.");
    try {
      setText("vaultStatus", "Refreshing vault...");
      setStatus("Refreshing vault...");

      const tx = await vault.refresh(user, { gasLimit: 450000 });
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

      const tx = await vault.claim({ gasLimit: 450000 });
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
      toast("Token added ✅");
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

    $("btnClaimStakeV4").onclick = claimStakeV4;

    $("btnClaimV5ById").onclick = claimStakeV5ById;
    $("btnClaimAllMaturedV5").onclick = claimAllMaturedV5;

    $("btnVaultRefresh").onclick = vaultRefresh;
    $("btnClaimVault").onclick = claimVault;

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
  }

  function initStatic() {
    setText("coreAddr", C.CORE);
    setText("vaultAddr", C.VAULT);
    setText("binaryAddr", C.BINARY);
    setText("stakingV4Addr", C.STAKING_V4);
    setText("stakingV5Addr", C.STAKING_V5);
    setText("usdtAddr", C.USDT);
    setText("dfAddr", C.DF);

    setText("walletAddr", "-");
    setText("netText", "-");
    setText("buyStatus", "Ready.");
    setText("dashStatus", "-");
    setText("vaultStatus", "-");

    // legacy (v4)
    setText("pendingStakeV4", "-");
    setText("stakeV4Principal", "-");
    setText("stakeV4End", "-");
    setText("stakeV4Claimed", "-");
    setText("stakeEndsAtHint", "-");
    setCountdownZeros();

    // v5
    setText("stakeV5Count", "-");
    setText("stakeV5Matured", "-");
    setText("pendingStakeV5Total", "-");
    setHTML("v5Lots", `<div class="hint">Connect wallet to load.</div>`);

    setStatus("Ready.");
  }

  window.addEventListener("load", () => {
    initStatic();
    bindUI();
    parseQueryAndApplySponsorLock();
  });
})();
