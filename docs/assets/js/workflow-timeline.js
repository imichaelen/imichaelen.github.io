function formatHours(hours) {
  if (!hours && hours !== 0) return "--";
  return `${hours.toFixed(2)} h`;
}

export function renderWorkflowSummary(containerSelector, workflow, idea) {
  const el = document.querySelector(containerSelector);
  if (!el) return;
  if (!workflow || !workflow.workflow_title) {
    el.textContent = "No workflow data available.";
    return;
  }

  const badges = [
    workflow.scores?.consensus && `Consensus: ${workflow.scores.consensus}`,
    workflow.scores?.feasibility && `Feasibility: ${workflow.scores.feasibility}`,
    workflow.scores?.impact_potential && `Impact: ${workflow.scores.impact_potential}`,
  ].filter(Boolean);

  const professorSteps = (workflow.professor_steps || [])
    .map(
      (s) => `
      <div class="list-step">
        <span class="pill">${s.number ?? ""}</span>
        <div class="text">${s.title}</div>
      </div>`
    )
    .join("");

  const technicianSteps = (workflow.technician_steps || [])
    .map(
      (s) => `
      <div class="list-step">
        <span class="pill">${s.order ?? ""}</span>
        <div class="text"><strong>${s.kind}</strong> — ${s.title}</div>
      </div>`
    )
    .join("");

  el.innerHTML = `
    <div class="workflow-card">
      <h3>${workflow.workflow_title}</h3>
      <p>${workflow.summary || ""}</p>
      <div class="metric-row">
        ${badges.map((b) => `<span class="metric">${b}</span>`).join("")}
        <span class="metric">Steps: ${workflow.metrics?.steps_completed ?? "--"}/${
    workflow.metrics?.steps_total ?? "--"
  }</span>
        <span class="metric">Executor: ${workflow.metrics?.executor ?? "--"}</span>
        <span class="metric">Duration: ${formatHours(workflow.metrics?.duration_hours)}</span>
      </div>
    </div>
    <div class="workflow-card">
      <h3>Idea Link</h3>
      <p><strong>${idea?.title || "Select an idea"}</strong></p>
      <p>${idea?.summary || ""}</p>
    </div>
    <div class="workflow-card">
      <h3>Professor Plan</h3>
      ${professorSteps}
    </div>
    <div class="workflow-card">
      <h3>Technician / FPilot Steps</h3>
      ${technicianSteps}
    </div>
    <div class="workflow-card">
      <h3>Methods</h3>
      <p>${workflow.methods || ""}</p>
      <h3>Risk Notes</h3>
      <p>${workflow.risks || ""}</p>
    </div>
  `;
}

export function renderTimeline(containerSelector, events = []) {
  const el = document.querySelector(containerSelector);
  if (!el) return;
  if (!events.length) {
    el.textContent = "No FPilot interactions available.";
    return;
  }

  el.innerHTML = events
    .map((ev) => {
      const statusClass = `status-${ev.status || "queued"}`;
      const metaParts = [];
      if (ev.timestamp) metaParts.push(new Date(ev.timestamp).toLocaleString());
      if (ev.t0_minutes !== undefined) metaParts.push(`+${ev.t0_minutes} min`);
      if (ev.duration_minutes !== undefined) metaParts.push(`~${ev.duration_minutes} min span`);

      return `
        <div class="timeline-item ${statusClass}">
          <div class="timeline-dot"></div>
          <div class="timeline-body">
            <div class="status-pill">${ev.kind === "fpilot" ? "FPilot" : "Analysis"}</div>
            <h4>${ev.title}</h4>
            <div class="meta">${metaParts.join(" · ")}</div>
            <p>${ev.details || ""}</p>
          </div>
        </div>
      `;
    })
    .join("");
}
