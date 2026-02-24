// app.js
;(() => {
  "use strict";
  const C = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const setText = (id, t) => { const el = $(id); if (el) el.textContent = String(t ?? "-"); };

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
  let usdt=null, dfToken=null, core=null, vault=null, binary=null;
  let stakingV4=null, stakingV5=null;
  let usdtDecimals=18, dfDecimals=18;

  let selectedPkg = 1;   // 1/2/3
  let sideRight = false;

  // ---- countdown V4 ----
  let countdownTimer = null;
  let legacyEndSec = 0;
  let legacyPrincipal = "0";
  let legacyClaimed = false;

  const PKG_NAME = ["None", "Small", "Medium", "Large"];
  const RANK_NAME = ["None", "Bronze", "Silver", "Gold"];
  const shortAddr = (a) => a ? (a.slice(0,6)+"..."+a.slice(-4)) : "-";

  function fmtUnits(x, d=18) {
    try {
      const n = Number(ethers.utils.formatUnits(x, d));
      if (!isFinite(n)) return String(x);
      return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
    } catch { return String(x ?? "-"); }
  }
  function fmtTS(sec) {
    try{
      const n = Number(sec || 0);
      if (!n) return "-";
      return new Date(n * 1000).toLocaleString();
    } catch { return "-"; }
  }
  function pad2(n){ return String(n).padStart(2,"0"); }

  function stopCountdown(){ if (countdownTimer) clearInterval(countdownTimer); countdownTimer=null; }
  function setCountdownZeros(){ setText("cdD","0"); setText("cdH","00"); setText("cdM","00"); setText("cdS","00"); }
  function startLegacyCountdown() {
    stopCountdown();
    const tick = () => {
      if (!legacyEndSec || legacyEndSec===0 || legacyPrincipal==="0") {
        setCountdownZeros(); setText("stakeEndsAtHint","No active legacy stake (V4)."); return;
      }
      if (legacyClaimed) {
        setCountdownZeros(); setText("stakeEndsAtHint","Legacy stake (V4) already claimed ✅"); return;
      }
      const now = Math.floor(Date.now()/1000);
      let diff = legacyEndSec - now;
      if (diff <= 0) {
        setCountdownZeros(); setText("stakeEndsAtHint","Legacy stake (V4) matured ✅ You can claim."); return;
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
    if (Number(net.chainId) === Number(C.CHAIN_ID_DEC)) return true;
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: C.CHAIN_ID_HEX }]);
      return true;
    } catch {
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
      if (navigator.share) { await navigator.share({ title:"365DF Referral", text:"Join via my referral link", url }); toast("Shared ✅"); }
      else { await copyText(url); }
    } catch {}
  }

  function pkgUSDTAmount(pkg) {
    if (pkg === 1) return ethers.utils.parseUnits("100", usdtDecimals);
    if (pkg === 2) return ethers.utils.parseUnits("1000", usdtDecimals);
    return ethers.utils.parseUnits("10000", usdtDecimals);
  }
  function pkgLabelFromId(pkgId){
    const n = Number(pkgId || 0);
    if (n === 1) return "Small";
    if (n === 2) return "Medium";
    if (n === 3) return "Large";
    return String(n);
  }

  // ===== 핵심: ตรวจ config ว่า Core ชี้ไป Staking ไหน + StakingV5 mlm ชี้ไป Core ไหม =====
  async function checkWiring() {
    try {
      const coreStaking = await core.STAKING();
      const stakingMlm = await stakingV5.mlm();

      const ok1 = coreStaking.toLowerCase() === C.STAKING_V5.toLowerCase();
      const ok2 = stakingMlm.toLowerCase() === C.CORE.toLowerCase();

      if (!ok1 || !ok2) {
        setText("dashStatus", "⚠ Config mismatch");
        toast("⚠ Config mismatch: stake may not show", "err");

        // ใส่รายละเอียดใน status ให้เห็นชัด
        setStatus(
          `⚠ Wiring mismatch\n` +
          `Core.STAKING=${coreStaking}\n` +
          `Expected=${C.STAKING_V5}\n` +
          `StakingV5.mlm=${stakingMlm}\n` +
          `Expected=${C.CORE}`
        );
      }
    } catch (e) {
      console.error(e);
    }
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

      usdt = new ethers.Contract(C.USDT, C.ERC20_ABI, signer);
      dfToken = new ethers.Contract(C.DF, C.ERC20_ABI, signer);

      core   = new ethers.Contract(C.CORE,   C.CORE_ABI,   signer);
      vault  = new ethers.Contract(C.VAULT,  C.VAULT_ABI,  signer);
      binary = new ethers.Contract(C.BINARY, C.BINARY_ABI, signer);

      stakingV4 = new ethers.Contract(C.STAKING_V4, C.STAKING_V4_ABI, signer);
      stakingV5 = new ethers.Contract(C.STAKING_V5, C.STAKING_V5_ABI, signer);

      try { usdtDecimals = Number(await usdt.decimals()); } catch { usdtDecimals = 18; }
      try { dfDecimals = Number(await dfToken.decimals()); } catch { dfDecimals = 18; }

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
      await checkWiring(); // ✅ สำคัญ

      window.ethereum.on?.("accountsChanged", () => location.reload());
      window.ethereum.on?.("chainChanged", () => location.reload());

      toast("Connected ✅");
      setStatus("Ready.");
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
      try {
        const u = await core.users(user);
        setText("myPkg", PKG_NAME[Number(u.pkg ?? 0)] || "-");
        setText("myRank", RANK_NAME[Number(u.rank ?? 0)] || "-");
        setText("mySponsor", u.sponsor && u.sponsor !== ethers.constants.AddressZero ? shortAddr(u.sponsor) : "0x0000...0000");
      } catch {
        setText("myPkg", "-"); setText("myRank", "-"); setText("mySponsor", "-");
      }

      // Binary
      try {
        const vols = await binary.volumesOf(user);
        setText("volL", fmtUnits(vols.l, dfDecimals));
        setText("volR", fmtUnits(vols.r, dfDecimals));
        setText("volP", fmtUnits(vols.p, dfDecimals));
      } catch {
        setText("volL","-"); setText("volR","-"); setText("volP","-");
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
      toast("Refresh failed", "err");
    }
  }

  async function refreshStakingV4(){
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
    } catch {
      setText("pendingStakeV4","-");
      setText("stakeV4Principal","-");
      setText("stakeV4End","-");
      setText("stakeV4Claimed","-");
      legacyEndSec=0; legacyPrincipal="0"; legacyClaimed=false;
      startLegacyCountdown();
    }
  }

  async function refreshStakingV5(){
    try {
      const count = Number((await stakingV5.stakeCount(user)).toString());
      setText("stakeV5Count", String(count));

      const totalPendingBN = await stakingV5.pendingRewardTotal(user);
      setText("pendingStakeV5Total", fmtUnits(totalPendingBN, dfDecimals));

      const wrap = $("v5Lots");
      if (wrap) wrap.innerHTML = "";

      let matured = 0;
      const now = Math.floor(Date.now()/1000);

      for (let i=0;i<count;i++){
        const lot = await stakingV5.stakeAt(user, i);
        const pkg = Number(lot.pkg);
        const principal = lot.principal;
        const start = Number(lot.start);
        const end = Number(lot.end);
        const claimed = !!lot.claimed;

        let pending = "0";
        try {
          const p = await stakingV5.pendingReward(user, i);
          pending = fmtUnits(p, dfDecimals);
        } catch {}

        const isMatured = (!claimed && end>0 && end<=now && principal && principal.toString()!=="0");
        if (isMatured) matured++;

        if (wrap) {
          const div=document.createElement("div");
          div.className="lot";
          div.innerHTML = `
            <div class="kv"><span>Stake ID</span><span class="mono">${i}</span></div>
            <div class="kv"><span>Package</span><span class="mono">${pkgLabelFromId(pkg)}</span></div>
            <div class="kv"><span>Principal</span><span class="mono">${fmtUnits(principal, dfDecimals)}</span></div>
            <div class="kv"><span>Pending</span><span class="mono">${pending}</span></div>
            <div class="kv"><span>Start</span><span class="mono">${fmtTS(start)}</span></div>
            <div class="kv"><span>End</span><span class="mono">${fmtTS(end)}</span></div>
            <div class="row" style="margin-top:10px">
              <button class="btn" data-claim="${i}">Claim</button>
              <button class="btn" data-use="${i}">Use this ID</button>
            </div>
          `;
          wrap.appendChild(div);
          div.querySelector('[data-use]')?.addEventListener("click", () => {
            $("inpClaimId").value = String(i);
            toast("stakeId filled ✅");
          });
          div.querySelector('[data-claim]')?.addEventListener("click", () => claimV5ById(i));
        }
      }

      setText("stakeV5Matured", String(matured));
    } catch (e) {
      console.error(e);
      setText("stakeV5Count","-");
      setText("stakeV5Matured","-");
      setText("pendingStakeV5Total","-");
      const wrap=$("v5Lots"); if(wrap) wrap.innerHTML="";
    }
  }

  async function refreshVault(){
    try {
      try { await vault.refresh(user, { gasLimit: 350000 }); } catch {}
      const earns = await vault.earns(user);
      const claimUSDT = await vault.claimableUSDT(user);

      setText("vClaimableUSDT", fmtUnits(claimUSDT, usdtDecimals));
      setText("vLockedUSDT", fmtUnits(earns.lockedUSDT, usdtDecimals));
      setText("vClaimedUSDT", fmtUnits(earns.claimedUSDT, usdtDecimals));
      setText("vUnlockedUSDT", fmtUnits(earns.unlockedUSDT, usdtDecimals));
      setText("vLockStartUSDT", fmtTS(earns.lockStartUSDT));
      setText("vLockEndUSDT", fmtTS(earns.lockEndUSDT));

      setText("vaultStatus", "Updated ✅");
    } catch (e) {
      console.error(e);
      setText("vaultStatus", "Vault error");
    }
  }

  async function claimVault(){
    try {
      const tx = await vault.claim({ gasLimit: 700000 });
      setText("vaultStatus", "Claiming... " + tx.hash);
      toast("Claim sent...");
      await tx.wait();
      setText("vaultStatus", "Claimed ✅");
      await refreshVault();
    } catch (e) {
      console.error(e);
      setText("vaultStatus", "Claim failed");
      toast("Vault claim failed", "err");
    }
  }

  async function claimV4(){
    try {
      const tx = await stakingV4.claimStake({ gasLimit: 600000 });
      toast("Claim V4 sent...");
      setStatus("Claiming V4... " + tx.hash);
      await tx.wait();
      toast("Claimed V4 ✅");
      await refreshStakingV4();
    } catch (e) {
      console.error(e);
      toast("Claim V4 failed", "err");
      setStatus("Claim V4 error: " + (e?.message || String(e)));
    }
  }

  async function claimV5ById(id){
    try {
      const stakeId = Number(id);
      if (!Number.isFinite(stakeId) || stakeId < 0) throw new Error("Invalid stakeId");
      const tx = await stakingV5.claimStake(stakeId, { gasLimit: 450000 });
      toast("Claim V5 sent...");
      setStatus("Claiming V5... " + tx.hash);
      await tx.wait();
      toast("Claimed V5 ✅");
      await refreshStakingV5();
    } catch (e) {
      console.error(e);
      toast("Claim V5 failed", "err");
      setStatus("Claim V5 error: " + (e?.message || String(e)));
    }
  }

  async function claimAllMaturedV5(){
    try {
      const raw = ($("inpMaxClaims").value || "").trim();
      const maxClaims = raw ? Number(raw) : 10;
      if (!Number.isFinite(maxClaims) || maxClaims <= 0) throw new Error("Invalid maxClaims");
      const tx = await stakingV5.claimAllMatured(maxClaims, { gasLimit: 900000 });
      toast("Claim All sent...");
      setStatus("Claiming All... " + tx.hash);
      await tx.wait();
      toast("Claim All ✅");
      await refreshStakingV5();
    } catch (e) {
      console.error(e);
      toast("Claim All failed", "err");
      setStatus("Claim All error: " + (e?.message || String(e)));
    }
  }

  async function approveUSDT(){
    try {
      const amt = pkgUSDTAmount(selectedPkg);
      const tx = await usdt.approve(C.CORE, amt);
      toast("Approve sent...");
      setStatus("Approving... " + tx.hash);
      await tx.wait();
      toast("Approved ✅");
      setText("buyStatus", "Approved ✅");
    } catch (e) {
      console.error(e);
      toast("Approve failed", "err");
      setText("buyStatus", "Approve failed: " + (e?.message || String(e)));
    }
  }

  async function buyOrUpgrade(){
    try {
      // ---- precheck balance & allowance เพื่อกัน error “exceeds balance” ----
      const amt = pkgUSDTAmount(selectedPkg);
      const bal = await usdt.balanceOf(user);
      if (bal.lt(amt)) throw new Error(`USDT ไม่พอ (ต้องใช้ ${fmtUnits(amt, usdtDecimals)} USDT)`);

      const allow = await usdt.allowance(user, C.CORE);
      if (allow.lt(amt)) throw new Error("Allowance ไม่พอ: กด Approve USDT ก่อน");

      let sponsor = ($("inpSponsor").value || "").trim();
      let placement = ($("inpPlacement").value || "").trim();

      if (sponsor && !ethers.utils.isAddress(sponsor)) throw new Error("Invalid sponsor address");
      if (placement && !ethers.utils.isAddress(placement)) throw new Error("Invalid placement address");

      if (!sponsor) sponsor = ethers.constants.AddressZero;
      if (!placement) placement = sponsor;

      setText("buyStatus", "Sending tx...");
      const tx = await core.buyOrUpgrade(selectedPkg, sponsor, placement, sideRight, { gasLimit: 1800000 });
      toast("Buy/Upgrade sent...");
      setStatus("Buying... " + tx.hash);
      await tx.wait();
      toast("Buy/Upgrade success ✅");
      setText("buyStatus", "Buy/Upgrade success ✅");
      await refreshAll();
      await checkWiring();
    } catch (e) {
      console.error(e);
      toast("Buy failed", "err");
      setText("buyStatus", "Buy error: " + (e?.message || String(e)));
      setStatus("Buy error: " + (e?.message || String(e)));
    }
  }

  async function addTokenToWallet(){
    try {
      const sym = await dfToken.symbol();
      const dec = await dfToken.decimals();
      await window.ethereum.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: C.DF, symbol: sym, decimals: Number(dec) } }
      });
      toast("Token added ✅");
    } catch (e) {
      console.error(e);
      toast("Add token failed", "err");
    }
  }

  window.addEventListener("load", () => {
    choosePkg(1);
    chooseSide(false);
    parseQueryAndApplySponsorLock();

    $("btnConnect").onclick = connect;
    $("btnRefresh").onclick = () => refreshAll(true);
    $("btnAddTokens").onclick = addTokenToWallet;

    $("btnCopyLeft")?.addEventListener("click", () => copyText($("leftLink").textContent || ""));
    $("btnCopyRight")?.addEventListener("click", () => copyText($("rightLink").textContent || ""));
    $("btnShareLeft")?.addEventListener("click", () => shareLink($("leftLink").textContent || ""));
    $("btnShareRight")?.addEventListener("click", () => shareLink($("rightLink").textContent || ""));

    ["pkg1","pkg2","pkg3"].forEach((id) => {
      $(id)?.addEventListener("click", () => choosePkg($(id).dataset.pkg));
    });
    $("btnSideL")?.addEventListener("click", () => chooseSide(false));
    $("btnSideR")?.addEventListener("click", () => chooseSide(true));

    $("btnApprove")?.addEventListener("click", approveUSDT);
    $("btnBuy")?.addEventListener("click", buyOrUpgrade);

    $("btnClaimStakeV4")?.addEventListener("click", claimV4);
    $("btnClaimV5ById")?.addEventListener("click", () => claimV5ById(($("inpClaimId").value || "").trim()));
    $("btnClaimAllMaturedV5")?.addEventListener("click", claimAllMaturedV5);

    $("btnVaultRefresh")?.addEventListener("click", refreshVault);
    $("btnClaimVault")?.addEventListener("click", claimVault);

    setStatus("Ready. Click Connect Wallet.");
  });
})();
