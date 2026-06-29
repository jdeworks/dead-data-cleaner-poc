import { useState } from "react";
import { useViewStore } from "../stores/view-store";

// Native questionnaire → POSTs to the public Google Form "dead-data-cleaner feedback"
// in no-cors mode (CORS blocks the response, but the submission goes through). No backend,
// no key, no proxy. Form id + entry ids + option strings extracted from the live form;
// the options MUST match the form character-for-character or Google rejects the choice.
const GOOGLE_FORM_ID = "1FAIpQLSdFgIrmzZXJuionKany0O42sUQhjTKXZl4sJPgtSwnd3jBnbw";

const FIELD = {
  today: "entry.802041725",
  impression: "entry.1758558717",
  pay: "entry.1009263761",
  role: "entry.128050824",
  mustHave: "entry.362448214", // checkbox — multi-select
  contact: "entry.1435394282",
  feedback: "entry.586765347",
} as const;

const TODAY = [
  "I don't - it just piles up",
  "Manually (grep, search, reading the code)",
  "Language-specific linters (knip, ts-prune, depcheck, vulture, cargo-udeps…)",
  'IDE "find usages" / unused warnings',
  "CI checks or coverage tools",
  'AI Prompt "Clean this up for me"',
];
const IMPRESSION = ["Love it", "Interesting", "Not sure yet", "Not for me"];
const PAY = ["Free only", "$1 to $5 / mo", "$5 to $15 / mo", "$15 to $30 / mo", "$30+ / mo"];
const ROLE = [
  "Developer / engineer",
  "Engineering lead / manager",
  "DevTools / platform engineer",
  "Founder / indie hacker",
  "Investor",
  "Just curious",
];
const MUST_HAVE = [
  "A visual map I can trust - see why before I delete",
  "Deterministic & CI-friendly - no flaky AI gating the results",
  "Beyond code - finds dead docs, data, and configs too",
  "One tool across all my languages",
  "AI help to explain and triage the findings",
];

interface SurveyData {
  today: string;
  impression: string;
  pay: string;
  role: string;
  mustHave: string[];
  contact: string;
  feedback: string;
}

const STORAGE_KEY = "dead-data-cleaner-poc-survey-responses";

export function SurveyPage() {
  const setView = useViewStore((s) => s.setView);
  const [data, setData] = useState<SurveyData>({
    today: "",
    impression: "",
    pay: "",
    role: "",
    mustHave: [],
    contact: "",
    feedback: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  function update(field: keyof SurveyData, value: string) {
    setData((prev) => ({ ...prev, [field]: value }));
  }

  function toggleMustHave(value: string) {
    setData((prev) => ({
      ...prev,
      mustHave: prev.mustHave.includes(value)
        ? prev.mustHave.filter((v) => v !== value)
        : [...prev.mustHave, value],
    }));
  }

  async function handleSubmit() {
    setSending(true);
    const form = new URLSearchParams();
    form.append(FIELD.today, data.today);
    form.append(FIELD.impression, data.impression);
    form.append(FIELD.pay, data.pay);
    form.append(FIELD.role, data.role);
    // Google Forms checkbox: one entry pair per selected option.
    for (const v of data.mustHave) form.append(FIELD.mustHave, v);
    form.append(FIELD.contact, data.contact);
    form.append(FIELD.feedback, data.feedback);

    try {
      await fetch(`https://docs.google.com/forms/d/e/${GOOGLE_FORM_ID}/formResponse`, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
    } catch {
      // no-cors gives no readable response; the submission still lands.
    }

    try {
      const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      prev.push({ ...data, at: new Date().toISOString() });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prev));
    } catch {
      /* ignore */
    }

    setSending(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mb-4 text-5xl">🙏</div>
        <h2 className="mb-3 text-2xl font-bold">Thank you!</h2>
        <p className="mb-6 text-fg-muted">
          Your feedback helps shape where dead-data-cleaner goes next.
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => setView("demo")}
            className="rounded-lg bg-accent-dim px-6 py-2 font-medium text-accent-fg"
          >
            Back to the demo
          </button>
          <button
            onClick={() => setView("roadmap")}
            className="rounded-lg border border-line px-6 py-2 font-medium text-fg-muted hover:text-fg"
          >
            See the road ahead
          </button>
        </div>
      </div>
    );
  }

  const canSubmit = data.today && data.impression && data.pay && data.role && !sending;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <div className="mb-8 text-center">
        <h1 className="mb-3 text-4xl font-bold tracking-tight">What do you think?</h1>
        <p className="text-fg-muted">Help shape dead-data-cleaner. Takes about 30 seconds.</p>
      </div>

      <div className="space-y-6">
        <Question label="How do you find and clean dead code / data today?">
          <Pills options={TODAY} selected={data.today} onSelect={(v) => update("today", v)} />
        </Question>
        <Question label="First impression of dead-data-cleaner?">
          <Pills
            options={IMPRESSION}
            selected={data.impression}
            onSelect={(v) => update("impression", v)}
          />
        </Question>
        <Question label="Would you pay for it?">
          <Pills options={PAY} selected={data.pay} onSelect={(v) => update("pay", v)} />
        </Question>
        <Question label="Which describes you best?">
          <Pills options={ROLE} selected={data.role} onSelect={(v) => update("role", v)} />
        </Question>
        <Question label="What would make this a must-have for you?" optional>
          <p className="mb-2 text-xs text-fg-muted">Select all that apply.</p>
          <MultiPills
            options={MUST_HAVE}
            selected={data.mustHave}
            onToggle={toggleMustHave}
          />
        </Question>
        <Question label="E-Mail or Phone" optional>
          <p className="mb-2 text-xs text-fg-muted">
            VC or generally interested? Leave contact info so we can reach out.
          </p>
          <input
            type="text"
            aria-label="E-Mail or Phone"
            value={data.contact}
            onChange={(e) => update("contact", e.target.value)}
            placeholder="hello@world"
            className="w-full rounded-lg border border-line bg-canvas p-3 text-base outline-none focus:ring-2 focus:ring-accent/50"
          />
        </Question>
        <Question label="Anything else you'd like to share?" optional>
          <textarea
            aria-label="Anything else you'd like to share?"
            value={data.feedback}
            onChange={(e) => update("feedback", e.target.value)}
            placeholder="Ideas, concerns, feature requests…"
            className="h-24 w-full resize-none rounded-lg border border-line bg-canvas p-3 text-base outline-none focus:ring-2 focus:ring-accent/50"
          />
        </Question>

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full rounded-lg bg-accent-dim py-3 font-medium text-accent-fg disabled:opacity-40"
        >
          {sending ? "Sending…" : "Submit feedback"}
        </button>
      </div>
    </div>
  );
}

function Question({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium">
        {label}
        {optional && <span className="ml-1 font-normal text-fg-muted">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

function Pills({
  options,
  selected,
  onSelect,
}: {
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onSelect(opt)}
          className={`rounded-full border px-4 py-2 text-sm transition-colors ${
            selected === opt
              ? "border-accent bg-accent/10 text-accent"
              : "border-line text-fg-muted hover:border-fg-muted"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function MultiPills({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onToggle(opt)}
          className={`rounded-full border px-4 py-2 text-sm transition-colors ${
            selected.includes(opt)
              ? "border-accent bg-accent/10 text-accent"
              : "border-line text-fg-muted hover:border-fg-muted"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
