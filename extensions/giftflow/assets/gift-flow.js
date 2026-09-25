/**
 * GiftFlow — storefront flow.
 *
 * Nothing about the shop is baked in here. The collection comes from the block
 * setting, and the cards, the limits and the card variant all come from the app
 * over the signed app proxy. That is the whole reason this can ship as a public
 * app: a merchant installing it has no candyexpress account and none of the
 * variant IDs the old theme hardcoded.
 *
 * The card and the message never reach the cart as text. They are posted to the
 * app, which sanitizes and stores them and returns a token; only the token and
 * one human-readable property go onto the line item.
 */
(function () {
  "use strict";

  const root = document.querySelector("[data-giftflow]");
  if (!root) return;

  const proxy = root.dataset.proxy || "/apps/giftflow";

  const state = {
    step: 1,
    product: null,
    variantId: null,
    cardId: null,
    uploadKey: null,
    settings: null,
    cards: [],
    categories: [],
    categoryId: null,
  };

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.from(root.querySelectorAll(sel));

  const els = {
    panels: $$("[data-panel]"),
    steps: $$("[data-giftflow-steps] li"),
    next: $("[data-next]"),
    back: $("[data-back]"),
    submit: $("[data-submit]"),
    fatal: $("[data-fatal]"),
    variants: $("[data-variants-target]"),
    cards: $("[data-cards]"),
    categories: $("[data-categories]"),
    upload: $("[data-upload]"),
    uploadInput: $("[data-upload-input]"),
    uploadError: $("[data-upload-error]"),
    message: $("[data-message]"),
    recipient: $("[data-recipient]"),
    sender: $("[data-sender]"),
    count: $("[data-count]"),
    limit: $("[data-limit]"),
    messageError: $("[data-message-error]"),
  };

  const LAST_STEP = 4;

  // ── navigation ─────────────────────────────────────────────────────────────

  function show(step) {
    state.step = step;
    els.panels.forEach((p) => p.classList.toggle("is-active", Number(p.dataset.panel) === step));
    els.steps.forEach((li) => li.classList.toggle("is-current", Number(li.dataset.step) === step));
    els.back.hidden = step === 1;
    els.next.hidden = step === LAST_STEP;
    els.submit.hidden = step !== LAST_STEP;
    refreshNext();
    root.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** The Next button is the only thing enforcing order, so it has to be honest
   *  about what each step actually requires. */
  function canAdvance() {
    switch (state.step) {
      case 1: return Boolean(state.product);
      case 2: return Boolean(state.variantId);
      case 3: return Boolean(state.cardId || state.uploadKey);
      default: return true;
    }
  }

  function refreshNext() {
    els.next.disabled = !canAdvance();
    els.submit.disabled = !(state.cardId || state.uploadKey) || !state.variantId;
  }

  els.next.addEventListener("click", () => {
    if (!canAdvance()) return;
    // A single-variant product has nothing to ask in step 2.
    if (state.step === 1 && state.product && state.product.variants.length === 1) {
      state.variantId = state.product.variants[0].id;
      return show(3);
    }
    show(Math.min(state.step + 1, LAST_STEP));
  });

  els.back.addEventListener("click", () => {
    if (state.step === 3 && state.product && state.product.variants.length === 1) return show(1);
    show(Math.max(state.step - 1, 1));
  });

  // ── step 1: product ────────────────────────────────────────────────────────

  $$("[data-product]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$("[data-product]").forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");

      let variants = [];
      try {
        variants = JSON.parse(btn.dataset.variants || "[]");
      } catch {
        variants = [];
      }
      state.product = {
        handle: btn.dataset.productHandle,
        title: btn.dataset.productTitle,
        variants,
      };
      state.variantId = null;
      renderVariants();
      refreshNext();
    });
  });

  function renderVariants() {
    els.variants.innerHTML = "";
    if (!state.product) return;

    state.product.variants.forEach((v) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "giftflow__variant";
      btn.disabled = v.available === false;
      btn.textContent = v.title + (v.available === false ? " — sold out" : "");
      btn.addEventListener("click", () => {
        els.variants.querySelectorAll("button").forEach((b) => b.classList.remove("is-selected"));
        btn.classList.add("is-selected");
        state.variantId = v.id;
        refreshNext();
      });
      els.variants.appendChild(btn);
    });
  }

  // ── step 3: cards, from the app ────────────────────────────────────────────

  async function loadCards() {
    try {
      const res = await fetch(`${proxy}/cards`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Cards unavailable (${res.status})`);
      const data = await res.json();

      state.settings = data.settings;
      state.cards = data.cards || [];
      state.categories = data.categories || [];

      els.limit.textContent = String(state.settings.messageMaxChars);
      els.upload.hidden = !state.settings.allowUploads;

      renderCategories();
      renderCards();
    } catch (err) {
      els.cards.innerHTML = "";
      fatal("The card designs could not be loaded. Please reload the page.");
      console.error("[giftflow]", err);
    }
  }

  function renderCategories() {
    els.categories.innerHTML = "";
    if (state.categories.length === 0) return;

    const all = [{ id: null, name: "All" }, ...state.categories];
    all.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "giftflow__category";
      btn.classList.toggle("is-selected", state.categoryId === cat.id);
      btn.textContent = cat.name;
      btn.addEventListener("click", () => {
        state.categoryId = cat.id;
        renderCategories();
        renderCards();
      });
      els.categories.appendChild(btn);
    });
  }

  function renderCards() {
    const list = state.categoryId
      ? state.cards.filter((c) => c.categoryId === state.categoryId)
      : state.cards;

    els.cards.innerHTML = "";
    if (list.length === 0) {
      const p = document.createElement("p");
      p.className = "giftflow__empty";
      p.textContent = "No cards in this category.";
      els.cards.appendChild(p);
      return;
    }

    list.forEach((card) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "giftflow__card";
      btn.classList.toggle("is-selected", state.cardId === card.id);

      if (card.thumbnail) {
        const img = document.createElement("img");
        img.src = card.thumbnail;
        img.alt = card.title;
        img.loading = "lazy";
        btn.appendChild(img);
      }
      const span = document.createElement("span");
      span.textContent = card.title;
      btn.appendChild(span);

      btn.addEventListener("click", () => {
        state.cardId = card.id;
        state.uploadKey = null;      // a catalogue card and an upload are exclusive
        if (els.uploadInput) els.uploadInput.value = "";
        renderCards();
        refreshNext();
      });
      els.cards.appendChild(btn);
    });
  }

  // ── step 3: upload ─────────────────────────────────────────────────────────

  if (els.uploadInput) {
    els.uploadInput.addEventListener("change", async () => {
      const file = els.uploadInput.files && els.uploadInput.files[0];
      if (!file) return;
      hide(els.uploadError);

      // The real check is on the server — this one only saves a pointless
      // round trip on an obviously oversized file.
      const max = state.settings?.maxUploadBytes ?? 5 * 1024 * 1024;
      if (file.size > max) {
        return showError(els.uploadError, `That image is larger than ${(max / 1024 / 1024).toFixed(0)} MB.`);
      }

      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch(`${proxy}/uploads`, { method: "POST", body });
        const data = await res.json();
        if (!res.ok) return showError(els.uploadError, data.error || "That image could not be uploaded.");

        state.uploadKey = data.uploadKey;
        state.cardId = null;
        renderCards();
        refreshNext();
        if (data.needsApproval) {
          showError(els.uploadError, "Your image will be checked by the shop before it is printed.");
        }
      } catch {
        showError(els.uploadError, "That image could not be uploaded. Please try again.");
      }
    });
  }

  // ── step 4: message ────────────────────────────────────────────────────────

  els.message.addEventListener("input", () => {
    const len = els.message.value.length;
    els.count.textContent = String(len);
    const limit = state.settings?.messageMaxChars ?? Infinity;
    els.count.parentElement.classList.toggle("is-over", len > limit);
    refreshNext();
  });

  // ── submit ─────────────────────────────────────────────────────────────────

  els.submit.addEventListener("click", async () => {
    els.submit.disabled = true;
    hide(els.messageError);

    try {
      // 1. Store the card and message; get the token back.
      const draftRes = await fetch(`${proxy}/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardDesignId: state.cardId || undefined,
          uploadKey: state.uploadKey || undefined,
          messageHtml: els.message.value,
          recipient: els.recipient.value || undefined,
          sender: els.sender.value || undefined,
        }),
      });
      const draft = await draftRes.json();
      if (!draftRes.ok) {
        showError(els.messageError, draft.error || "Your message could not be saved.");
        els.submit.disabled = false;
        return;
      }

      // 2. The gift line carries the token and one readable property. The card
      //    charge, if the merchant set one, is a second line.
      const items = [{ id: state.variantId, quantity: 1, properties: draft.properties }];
      if (draft.cardVariantId) {
        items.push({
          id: Number(draft.cardVariantId),
          quantity: 1,
          properties: { _gift_token: draft.token },
        });
      }

      const cartRes = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!cartRes.ok) {
        const err = await cartRes.json().catch(() => ({}));
        throw new Error(err.description || "Could not add to cart");
      }

      window.location.href = "/cart";
    } catch (err) {
      console.error("[giftflow]", err);
      showError(els.messageError, "Something went wrong adding this to your cart. Please try again.");
      els.submit.disabled = false;
    }
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  function showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }
  function hide(el) { if (el) el.hidden = true; }
  function fatal(msg) { showError(els.fatal, msg); }

  loadCards();
  show(1);
})();
