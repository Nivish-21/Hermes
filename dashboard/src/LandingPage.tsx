import { useState, type FormEvent } from "react";

const registrationEndpoint = "https://festive-starfish-979.convex.site/register";

function Mark() {
  return <span className="landing-mark" aria-hidden="true"><i /><i /><i /></span>;
}

function Arrow() {
  return <span className="landing-arrow" aria-hidden="true">↗</span>;
}

function RegistrationForm() {
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    setState("submitting");
    setMessage("Submitting your application…");
    try {
      const response = await fetch(registrationEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(data.get("email") ?? ""),
          name: String(data.get("name") ?? ""),
          company: String(data.get("company") ?? ""),
          website: String(data.get("website") ?? ""),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Registration could not be completed.");
      setState("success");
      setMessage("Application received. Continue in Telegram and send /start.");
      form.reset();
    } catch (error: unknown) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Registration could not be completed.");
    }
  };

  return (
    <form className="beta-form" onSubmit={(event) => void submit(event)}>
      <div className="beta-field"><label htmlFor="beta-name">Name <span>optional</span></label><input id="beta-name" name="name" maxLength={100} autoComplete="name" /></div>
      <div className="beta-field"><label htmlFor="beta-email">Email <span>required</span></label><input id="beta-email" name="email" type="email" maxLength={254} autoComplete="email" required /></div>
      <div className="beta-field"><label htmlFor="beta-company">Company <span>optional</span></label><input id="beta-company" name="company" maxLength={160} autoComplete="organization" /></div>
      <div className="beta-honeypot" aria-hidden="true"><label htmlFor="beta-website">Website</label><input id="beta-website" name="website" tabIndex={-1} autoComplete="off" /></div>
      <label className="beta-consent"><input type="checkbox" required /><span>I agree to the <a href="/terms.html" target="_blank">Terms</a> and acknowledge the <a href="/privacy.html" target="_blank">Privacy Policy</a>.</span></label>
      <button className="landing-primary beta-submit" disabled={state === "submitting"} type="submit">{state === "submitting" ? "Submitting…" : "Request beta access"} <Arrow /></button>
      <p className={`beta-status ${state}`} role="status" aria-live="polite">{message}</p>
      {state === "success" && <a className="landing-secondary beta-telegram" href="https://t.me/Switchboardxbot?start=beta">Open @Switchboardxbot <Arrow /></a>}
    </form>
  );
}

function LandingPage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <a className="landing-brand" href="/"><Mark />switchboard</a>
        <div className="landing-nav-links"><a href="#method">How it works</a><a href="#proof">Proof</a><a href="#register">Register</a></div>
        <a className="landing-dashboard-link" href="/dashboard">Live dashboard <Arrow /></a>
      </nav>

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="landing-kicker">Invite-only research beta</p>
          <h1>Ask the question.<br /><span>The evidence follows through.</span></h1>
          <p className="landing-intro">Switchboard turns a private Telegram research request into a citation-backed brief, verifies the result, and records a privacy-safe execution trail.</p>
          <div className="landing-actions"><a className="landing-primary" href="#register">Request beta access <Arrow /></a><a className="landing-secondary" href="/dashboard">Watch a live run <Arrow /></a></div>
          <p className="landing-caption">Manual approval. Private research. No self-serve workspace or shared actions.</p>
        </div>

        <div className="run-figure" aria-label="A research request moving from Telegram through verification">
          <div className="figure-field" />
          <div className="figure-line line-request" /><div className="figure-line line-research" /><div className="figure-line line-verify" />
          <div className="run-card request-node"><span className="run-card-index">01</span><div><small>TELEGRAM / PRIVATE INPUT</small><strong>Find recent coverage for the launch</strong></div><span className="run-card-state">new</span></div>
          <div className="manager-node"><span className="manager-ring" /><Mark /><small>MANAGER</small><strong>route</strong></div>
          <div className="run-card research-node"><span className="run-card-index">02</span><div><small>SPECIALIST / RESEARCH</small><strong>Source brief in progress</strong></div><span className="run-card-state">working</span></div>
          <div className="run-card verify-node"><span className="verify-check">✓</span><div><small>VERIFY</small><strong>Citations resolve. Private reply sent.</strong></div><span className="run-card-state">done</span></div>
          <p className="figure-note">OBSERVE · ACT · VERIFY · RECOVER</p>
        </div>
      </section>

      <section className="landing-statement" id="method">
        <p className="landing-kicker">It is not another chat window.</p>
        <div><h2>Every question is a run,<br />not just a response.</h2><p>Switchboard selects a bounded research workflow, verifies the evidence, and records what each step cost. Beta users receive results privately; request identity and text stay out of the public proof view.</p></div>
      </section>

      <section className="method-list" aria-label="How Switchboard handles a request">
        <article><span>01</span><h3>Request access</h3><p>Register, open the Telegram bot, and send <code>/start</code> for manual review.</p></article>
        <article><span>02</span><h3>Research</h3><p>Approved users send a private <code>/research</code> question.</p></article>
        <article><span>03</span><h3>Verify</h3><p>Citations and delivery are checked before the run counts as complete.</p></article>
      </section>

      <section className="proof-panel" id="proof">
        <div className="proof-panel-heading"><p className="landing-kicker">The receipts stay attached.</p><h2>See the work<br />without seeing the user.</h2></div>
        <div className="proof-preview"><div className="preview-top"><span><i /> PRIVACY-SAFE EXECUTION VIEW</span><a href="/dashboard">Open dashboard <Arrow /></a></div><div className="preview-body"><div className="preview-cost"><small>ROUTED COST</small><strong>$0.0142</strong><span>vs. $0.0384 frontier-only</span><b>$0.0242 saved</b></div><div className="preview-trace"><small>DECISION TRAIL</small><div><i /><span>manager</span><em>frontier</em><b>route</b></div><div className="preview-child"><i /><span>specialist</span><em>research</em><b>act</b></div><div className="preview-child"><i /><span>verify</span><em>system</em><b>pass</b></div></div></div></div>
      </section>

      <section className="boundary-section" id="boundaries">
        <div><p className="landing-kicker">Bounded by design.</p><h2>Research is live.<br />Shared actions are not.</h2></div>
        <div className="boundary-list"><article><span>01</span><div><h3>Private destination</h3><p>Approved beta research replies return only to the requesting Telegram account.</p></div></article><article><span>02</span><div><h3>Real verification</h3><p>A model does not declare success; citations and delivery are checked.</p></div></article><article><span>03</span><div><h3>Operator boundary</h3><p>Messaging, booking, publishing, free-form routing, and workspaces remain unavailable to beta users.</p></div></article></div>
      </section>

      <section className="beta-section" id="register"><div><p className="landing-kicker">CONTROLLED US BETA</p><h2>Request an invitation.</h2><p>Registration creates an application, not an account. We use these details only to review and operate beta access.</p></div><RegistrationForm /></section>

      <section className="landing-close"><p className="landing-kicker">Research first. Evidence attached.</p><h2>Give the question<br />a verified <span>way through.</span></h2><a className="landing-primary landing-light" href="#register">Request beta access <Arrow /></a></section>
      <footer className="landing-footer"><a className="landing-brand" href="/"><Mark />switchboard</a><span>Invite-only Telegram research beta.</span><span><a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a> · <a href="mailto:nivishv2004@gmail.com">Contact</a></span></footer>
    </main>
  );
}

export default LandingPage;
