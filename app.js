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
  let usdt=null, core=null, vault=null, binary=null, staking=null;
  let usdtDecimals=18, dfDecimals=18;

  let selectedPkg = 1;   // 1/2/3
  let sideRight = false; // false=L true=R

  const PKG_NAME = ["None", "Small", "Medium", "Large"];
  const RANK_NAME = ["None", "Bronze", "Silver", "Gold"];

  function fmtUnits(x, d=18) {
    try {
      return Number(ethers.utils.formatUnits(x, d)).toLocaleString(undefined, { maximumFractionDigits: 6 });
    } catch { return String(x); }
  }

  function fmtTS(sec) {
    try{
      const n = Number(sec || 0);
      if (!n) return "-";
      return new Date(n * 1000).toLocaleString();
    } catch { return "-"; }
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
      hint.textContent = "Sponsor is locked from referral link.";
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

      // contracts
      usdt   = new ethers.Contract(C.USDT,   C.ERC20_ABI,  signer);
      const dfToken = new ethers.Contract(C.DF, C.ERC20_ABI, signer);

      core   = new ethers.Contract(C.CORE,   C.CORE_ABI,   signer);
      vault  = new ethers.Contract(C.VAULT,  C.VAULT_ABI,  signer);
      binary = new ethers.Contract(C.BINARY, C.BINARY_ABI, signer);
      staking= new ethers.Contract(C.STAKING,C.STAKING_ABI,signer);

      try { usdtDecimals = await usdt.decimals(); } catch { usdtDecimals = 18; }
      try { dfDecimals = await dfToken.decimals(); } catch { dfDecimals = 18; }

      setText("walletAddr", shortAddr(user));
      setText("netText", "BSC (56)");
      $("btnConnect").textContent = "Connected";
      $("btnConnect").disabled = true;

      setText("coreAddr", C.CORE);
      setText("vaultAddr", C.VAULT);
      setText("binaryAddr", C.BINARY);
      setText("stakingAddr", C.STAKING);
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

      // Staking
      const pending = await staking.pendingReward(user);
      setText("pendingStake", fmtUnits(pending, dfDecimals));

      const s = await staking.stakes(user);
      setText("stakeEnd", fmtTS(s.end));
      setText("stakeClaimed", s.claimed ? "YES" : "NO");

      // Vault
      const cU = await vault.claimableUSDT(user);
      setText("vClaimableUSDT", fmtUnits(cU, usdtDecimals));

      const e = await vault.earns(user);
      setText("vUnlockedUSDT", fmtUnits(e.unlockedUSDT, usdtDecimals));
      setText("vClaimedUSDT", fmtUnits(e.claimedUSDT, usdtDecimals));
      setText("vLockedUSDT", fmtUnits(e.lockedUSDT, usdtDecimals));
      setText("vLockStartUSDT", fmtTS(e.lockStartUSDT));
      setText("vLockEndUSDT", fmtTS(e.lockEndUSDT));

      // info text
      const warnEl = $("vaultWarn");
      if (warnEl) {
        const now = Math.floor(Date.now()/1000);
        const end = Number(e.lockEndUSDT || 0);
        if (Number(e.lockedUSDT || 0) > 0 && end > 0) {
          warnEl.textContent = (now > end)
            ? "⚠️ Locked period ended (past lock window). It may become expired depending on contract rules."
            : "ℹ️ You have Locked rewards. They will unlock when your cap increases via buy/upgrade. Use Refresh/Claim as required.";
        } else {
          warnEl.textContent = "ℹ️ Locked rewards will be unlocked when your cap increases via buy/upgrade. Use Refresh/Claim as required.";
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
        toast("Invalid placement parent address", "err");
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

  async function claimStake() {
    if (!user) return alert("Please connect wallet first.");
    try {
      setStatus("Claiming stake...");
      const tx = await staking.claimStake({ gasLimit: 350000 });
      await tx.wait();
      toast("Claim Stake success ✅");
      await refreshAll(true);
    } catch (e) {
      console.error(e);
      const msg = e?.data?.message || e?.error?.message || e?.message || String(e);
      setStatus("Claim Stake error: " + msg);
      toast("Claim Stake failed", "err");
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
        params: {
          type: "ERC20",
          options: { address: C.DF, symbol: "365DF", decimals: Number(dfDecimals || 18) }
        }
      });

      await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: { address: C.USDT, symbol: "USDT", decimals: Number(usdtDecimals || 18) }
        }
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

    $("btnClaimStake").onclick = claimStake;

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
    setText("stakingAddr", C.STAKING);
    setText("usdtAddr", C.USDT);
    setText("dfAddr", C.DF);

    setText("walletAddr", "-");
    setText("netText", "-");
    setText("buyStatus", "Ready.");
    setText("dashStatus", "-");
    setText("vaultStatus", "-");
    setStatus("Ready.");
  }

  window.addEventListener("load", () => {
    initStatic();
    bindUI();
    parseQueryAndApplySponsorLock();
  });
})();
