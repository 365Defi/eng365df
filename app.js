// app.js (CoreV6 + VaultV6 + BinaryV4 + StakingV4 legacy + StakingV5 multi-lot)
// Requires: ethers v5.7.2 + config.js (window.APP_CONFIG)

;(() => {
  "use strict";
  const C = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);

  const setText = (id, t) => { const el = $(id); if (el) el.textContent = String(t ?? "-"); };
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

  // ---- globals ----
  let provider = null, signer = null, user = null;
  let usdt = null, dfToken = null, core = null, vault = null, binary = null;
  let stakingV4 = null, stakingV5 = null;

  let usdtDecimals = 18, dfDecimals = 18;

  let selectedPkg = 1;      // 1/2/3
  let sideRight = false;    // false=L true=R

  // ---- Legacy V4 countdown ----
  let countdownTimer = null;
  let legacyEndSec = 0;
  let legacyPrincipal = "0";
  let legacyClaimed = false;

  // ---- constants ----
  const PKG_NAME = ["None", "Small", "Medium", "Large"];
  const RANK_NAME = ["None", "Bronze", "Silver", "Gold"];
  const STAKE_PKG_NAME_V5 = ["Small", "Medium", "Large"]; // v5 package enum: 0/1/2

  // ---- format helpers ----
  function fmtUnits(x, d = 18) {
    try {
      return Number(ethers.utils.formatUnits(x, d)).toLocaleString(undefined, { maximumFractionDigits: 6 });
    } catch {
      try { return ethers.utils.formatUnits(x, d); } catch { return String(x); }
    }
  }
  function fmtTS(sec) {
    try {
      const n = Number(sec || 0);
      if (!n) return "-";
      return new Date(n * 1000).toLocaleString();
    } catch { return "-"; }
  }
  function pad2(n) { return String(n).padStart(2, "0"); }

  // ---- countdown ----
  function stopCountdown() {
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

  // ---- chain helpers (Bitget/MetaMask safe) ----
  async function ensureBSC() {
    if (!window.ethereum) throw new Error("Wallet not found. Open in MetaMask/Bitget DApp Browser.");
    const want = C.CHAIN_ID_HEX || "0x38";

    // always request accounts first (Bitget often needs this)
    await window.ethereum.request({ method: "eth_requestAccounts" });

    const cur = await window.ethereum.request({ method: "eth_chainId" });
    if (cur === want) return true;

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: want }],
      });
      return true;
    } catch (e) {
      const msg = String(e?.message || e);
      if (e?.code === 4902 || msg.includes("4902")) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: want,
            chainName: C.CHAIN_NAME || "BSC Mainnet",
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: [C.RPC_URL || "https://bsc-dataseed.binance.org/"],
            blockExplorerUrls: [C.BLOCK_EXPLORER || "https://bscscan.com"],
          }],
        });
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: want }],
        });
        return true;
      }
      if (e?.code === 4001) throw new Error("You rejected chain switch.");
      throw new Error("Please switch to BSC (56) in your wallet.");
    }
  }

  function rebuildProviderSigner() {
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    signer = provider.getSigner();
  }

  // ---- UI selection ----
  function chooseSide(isRight) {
    sideRight = !!isRight;
    $("btnSideL")?.classList.toggle("primary", !sideRight);
    $("btnSideL")?.classList.toggle("ghost", sideRight);
    $("btnSideR")?.classList.toggle("primary", sideRight);
    $("btnSideR")?.classList.toggle("ghost", !sideRight);
  }

  function choosePkg(pkg) {
    selectedPkg = Number(pkg);
    ["pkg1", "pkg2", "pkg3"].forEach((id, idx) => {
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
    setText("leftLink", `${base}?ref=${user}&side=L`);
    setText("rightLink", `${base}?ref=${user}&side=R`);
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
    } catch { }
  }

  // ---- package amount ----
  function pkgUSDTAmount(pkg) {
    if (pkg === 1) return ethers.utils.parseUnits("100", usdtDecimals);
    if (pkg === 2) return ethers.utils.parseUnits("1000", usdtDecimals);
    return ethers.utils.parseUnits("10000", usdtDecimals);
  }

  // ---- connect ----
  async function connect() {
    try {
      if (!window.ethereum) {
        alert("Wallet not found. Please open this site in Bitget/MetaMask DApp Browser.");
        return;
      }

      setStatus("Connecting...");
      await ensureBSC();
      rebuildProviderSigner();

      user = await signer.getAddress();

      // contracts
      usdt = new ethers.Contract(C.USDT, C.ERC20_ABI, signer);
      dfToken = new ethers.Contract(C.DF, C.ERC20_ABI, signer);

      core = new ethers.Contract(C.CORE, C.CORE_ABI, signer);
      vault = new ethers.Contract(C.VAULT, C.VAULT_ABI, signer);
      binary = new ethers.Contract(C.BINARY, C.BINARY_ABI, signer);

      stakingV4 = new ethers.Contract(C.STAKING_V4, C.STAKING_V4_ABI, signer);
      stakingV5 = new ethers.Contract(C.STAKING_V5, C.STAKING_V5_ABI, signer);

      try { usdtDecimals = await usdt.decimals(); } catch { usdtDecimals = 18; }
      try { dfDecimals = await dfToken.decimals(); } catch { dfDecimals = 18; }

      setText("walletAddr", shortAddr(user));
      setText("netText", "BSC (56)");
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
      setStatus("Connected ✅");
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      toast("Connect failed", "err");
      setStatus("Connect error: " + msg);
    }
  }

  // ---- refresh all ----
  async function refreshAll(showToast = false) {
    if (!user) return;
    try {
      setText("dashStatus", "Refreshing...");
      setStatus("Refreshing...");

      // Core users()
      const u = await core.users(user);
      setText("myPkg", PKG_NAME[Number(u.pkg)] || "-");
      setText("myRank", RANK_NAME[Number(u.rank)] || "-");
      setText("mySponsor", (u.sponsor && u.sponsor !== ethers.constants.AddressZero) ? shortAddr(u.sponsor) : "0x0000...0000");

      // Binary volumes
      const vols = await binary.volumesOf(user);
      setText("volL", fmtUnits(vols.l, dfDecimals));
      setText("volR", fmtUnits(vols.r, dfDecimals));
      setText("volP", fmtUnits(vols.p, dfDecimals));

      // ===== Legacy Staking V4 =====
      try {
        const pending4 = await stakingV4.pendingReward(user);
        setText("pendingStakeV4", fmtUnits(pending4, dfDecimals));

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
        legacyEndSec = 0;
        legacyClaimed = false;
        legacyPrincipal = "0";
        startLegacyCountdown();
      }

      // ===== Staking V5 (multi-lot list) =====
      await refreshV5Lots();

      // ===== Vault =====
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
        const now = Math.floor(Date.now() / 1000);
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
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      toast("Refresh failed", "err");
      setStatus("Refresh error: " + msg);
      setText("dashStatus", "Refresh error");
    }
  }

  async function refreshV5Lots() {
    // show count, total pending, matured count, and list lots
    const wrap = $("v5Lots");
    if (wrap) wrap.innerHTML = "";

    try {
      const countBN = await stakingV5.stakeCount(user);
      const count = Number(countBN.toString());
      setText("stakeV5Count", String(count));

      let totalPending = ethers.constants.Zero;
      try {
        totalPending = await stakingV5.pendingRewardTotal(user);
        setText("pendingStakeV5Total", fmtUnits(totalPending, dfDecimals));
      } catch {
        setText("pendingStakeV5Total", "-");
      }

      const now = Math.floor(Date.now() / 1000);
      let maturedNotClaimed = 0;

      // render up to ALL lots (safe-ish). If you ever get huge counts, we can paginate later.
      const rows = [];
      for (let i = 0; i < count; i++) {
        const lot = await stakingV5.stakeAt(user, i);
        const pkg = Number(lot.pkg);
        const principal = lot.principal;
        const start = Number(lot.start);
        const end = Number(lot.end);
        const claimed = !!lot.claimed;

        let pending = ethers.constants.Zero;
        try {
          pending = await stakingV5.pendingReward(user, i);
        } catch { }

        const matured = (!claimed && end > 0 && now >= end);
        if (matured) maturedNotClaimed++;

        rows.push({
          id: i,
          pkg,
          principal,
          start,
          end,
          claimed,
          pending,
          matured
        });
      }

      setText("stakeV5Matured", String(maturedNotClaimed));

      // build HTML
      if (wrap) {
        if (rows.length === 0) {
          wrap.innerHTML = `<div class="hint">No V5 stake lots.</div>`;
        } else {
          wrap.innerHTML = rows.map(r => {
            const pkgName = STAKE_PKG_NAME_V5[r.pkg] || `Pkg#${r.pkg}`;
            const tag = r.matured ? `<span class="pill" style="margin-left:8px">MATURED</span>` : "";
            const claimedTag = r.claimed ? `<span class="pill" style="margin-left:8px">CLAIMED</span>` : "";
            const btn = (!r.claimed && r.end > 0 && (Math.floor(Date.now()/1000) >= r.end))
              ? `<button class="btn primary v5ClaimBtn" data-id="${r.id}">Claim</button>`
              : `<button class="btn v5ClaimBtn" data-id="${r.id}">Claim</button>`;

            return `
              <div class="box" style="margin-bottom:12px">
                <div class="kv"><span>Stake ID</span><span class="mono">${r.id}${tag}${claimedTag}</span></div>
                <div class="kv"><span>Package</span><span class="mono">${pkgName}</span></div>
                <div class="kv"><span>Principal</span><span class="mono">${fmtUnits(r.principal, dfDecimals)}</span></div>
                <div class="kv"><span>Pending</span><span class="mono">${fmtUnits(r.pending, dfDecimals)}</span></div>
                <div class="kv"><span>Start</span><span class="mono">${fmtTS(r.start)}</span></div>
                <div class="kv"><span>End</span><span class="mono">${fmtTS(r.end)}</span></div>
                <div class="row" style="margin-top:10px; gap:10px">
                  ${btn}
                  <button class="btn v5FillIdBtn" data-id="${r.id}">Use this ID</button>
                </div>
              </div>
            `;
          }).join("");
        }
      }
    } catch (e) {
      console.error(e);
      setText("stakeV5Count", "-");
      setText("stakeV5Matured", "-");
      setText("pendingStakeV5Total", "-");
      if (wrap) wrap.innerHTML = `<div class="hint">V5 read error.</div>`;
    }
  }

  // ---- actions ----
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

      if (!ethers.utils.isAddress(sponsor)) {
        toast("Invalid sponsor address", "err");
        return;
      }

      // IMPORTANT (CoreV6): if placement empty => pass AddressZero to allow CoreV6 auto-find slot from sponsor
      let placementArg = ethers.constants.AddressZero;
      if (placement) {
        if (!ethers.utils.isAddress(placement)) {
          toast("Invalid placement address", "err");
          return;
        }
        placementArg = placement;
      }

      setText("buyStatus", "Sending transaction...");
      setStatus("Sending buyOrUpgrade...");

      const tx = await core.buyOrUpgrade(selectedPkg, sponsor, placementArg, sideRight);
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

  async function claimStakeV4() {
    if (!user) return alert("Please connect wallet first.");
    try {
      setStatus("Claiming V4 stake...");
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

  async function claimV5ById() {
    if (!user) return alert("Please connect wallet first.");
    try {
      const idStr = ($("inpClaimId").value || "").trim();
      if (!idStr) return toast("Enter stakeId", "err");
      const stakeId = ethers.BigNumber.from(idStr);

      setStatus("Claiming V5 stakeId " + stakeId.toString() + "...");
      const tx = await stakingV5.claimStake(stakeId, { gasLimit: 550000 });
      await tx.wait();

      toast("Claim V5 success ✅");
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
      const mcStr = ($("inpMaxClaims").value || "").trim();
      const maxClaims = mcStr ? ethers.BigNumber.from(mcStr) : ethers.BigNumber.from("10");

      setStatus("Claiming all matured V5 (maxClaims=" + maxClaims.toString() + ")...");
      const tx = await stakingV5.claimAllMatured(maxClaims, { gasLimit: 900000 });
      await tx.wait();

      toast("Claim All matured ✅");
      await refreshAll(true);
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      setStatus("ClaimAll error: " + msg);
      toast("Claim All failed", "err");
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

  // ---- bind UI ----
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

    $("btnClaimV5ById").onclick = claimV5ById;
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

    // V5 dynamic buttons (rendered inside #v5Lots)
    document.addEventListener("click", async (ev) => {
      const t = ev.target;
      if (!t) return;

      if (t.classList && t.classList.contains("v5FillIdBtn")) {
        const id = t.getAttribute("data-id");
        if ($("inpClaimId")) $("inpClaimId").value = id;
        toast("StakeId set ✅");
      }

      if (t.classList && t.classList.contains("v5ClaimBtn")) {
        const id = t.getAttribute("data-id");
        if ($("inpClaimId")) $("inpClaimId").value = id;
        await claimV5ById();
      }
    });
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
    setText("stakeEndsAtHint", "-");
    setCountdownZeros();

    setText("stakeV4Principal", "-");
    setText("pendingStakeV4", "-");
    setText("stakeV4End", "-");
    setText("stakeV4Claimed", "-");

    setText("stakeV5Count", "-");
    setText("stakeV5Matured", "-");
    setText("pendingStakeV5Total", "-");

    setStatus("Ready.");
  }

  // ---- start ----
  window.addEventListener("load", () => {
    initStatic();
    bindUI();
    parseQueryAndApplySponsorLock();
  });
})();
