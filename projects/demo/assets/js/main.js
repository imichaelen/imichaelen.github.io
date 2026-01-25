import { getDemoData } from "./data-loader.js";
import { renderIdeaTree } from "./tree-visualization.js";
import { renderWorkflowSummary, renderTimeline } from "./workflow-timeline.js";

function updateIdeaDetail(idea) {
  const detail = document.getElementById("idea-detail");
  if (!detail || !idea) return;

  detail.innerHTML = `
    <h3>${idea.title}</h3>
    <p>${idea.summary || ""}</p>
    <p><strong>Hypothesis:</strong> ${idea.hypothesis || ""}</p>
    <div class="metric-row">
      <span class="metric">Novelty: ${idea.novelty ?? "--"}</span>
      <span class="metric">Feasibility: ${idea.feasibility ?? "--"}</span>
      <span class="metric">Score: ${idea.score ?? "--"}</span>
      <span class="metric">Depth: ${idea.depth ?? "--"}</span>
    </div>
  `;
}

function setBadge(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function highlightSection(sectionId) {
  document.querySelectorAll(".section").forEach((sec) => sec.classList.remove("highlight"));
  const target = document.getElementById(sectionId);
  if (target) target.classList.add("highlight");
}

function renderTopic(topic) {
  const card = document.getElementById("topic-card");
  const statsEl = document.getElementById("topic-stats");
  if (card) {
    card.innerHTML = `
      <h3>${topic?.title || "2D Spintronics"}</h3>
      <p>${topic?.summary || "Balanced idea exploration over 2D spintronics."}</p>
    `;
  }
  if (statsEl && topic?.stats) {
    const s = topic.stats;
    statsEl.innerHTML = `
      <span class="metric">Strategy: ${s.strategy}</span>
      <span class="metric">Creativity: ${s.creativity_weight}</span>
      <span class="metric">Feasibility: ${s.feasibility_weight}</span>
      <span class="metric">Cost: ${s.cost_weight}</span>
      <span class="metric">Depth: ${s.max_depth}</span>
      <span class="metric">Nodes: ${s.nodes_explored}</span>
    `;
  }
}

function renderSelectedIdea(idea) {
  const el = document.getElementById("selected-idea");
  if (!el) return;
  el.innerHTML = `
    <div class="card">
      <h3>${idea?.title || "Select an idea"}</h3>
      <p>${idea?.summary || ""}</p>
      <p><strong>Why this idea:</strong> Novelty ${idea?.novelty ?? "--"}, Feasibility ${
    idea?.feasibility ?? "--"
  }, Score ${idea?.score ?? "--"}</p>
    </div>
  `;
}

function renderPlanning(workflow) {
  const el = document.getElementById("planning-content");
  if (!el) return;
  const professorSteps = (workflow.professor_steps || [])
    .map(
      (s) => `
        <div class="list-step">
          <span class="pill">${s.number ?? ""}</span>
          <div class="text">${s.title}</div>
        </div>
      `
    )
    .join("");
  el.innerHTML = `
    <div class="workflow-card">
      <h3>${workflow.workflow_title}</h3>
      <p>${workflow.summary || ""}</p>
      <div class="metric-row">
        <span class="metric">Consensus: ${workflow.scores?.consensus ?? "--"}</span>
        <span class="metric">Feasibility: ${workflow.scores?.feasibility ?? "--"}</span>
        <span class="metric">Impact: ${workflow.scores?.impact_potential ?? "--"}</span>
      </div>
    </div>
    <div class="workflow-card">
      <h3>Professor Plan</h3>
      ${professorSteps}
      <h4>Methods</h4>
      <p>${workflow.methods || ""}</p>
    </div>
  `;
}

function renderJourneyTimeline(containerSelector, steps) {
  const el = document.querySelector(containerSelector);
  if (!el) return;
  el.innerHTML = steps
    .map(
      (step, idx) => `
      <div class="timeline-item journey-step status-${step.status}" data-section="${step.section}">
        <div class="timeline-dot"></div>
        <div class="timeline-body">
          <div class="status-pill">Step ${idx + 1}</div>
          <h4>${step.title}</h4>
          <div class="meta">${step.duration || ""}</div>
          <p>${step.description}</p>
          <p><strong>Data:</strong> ${step.data || ""}</p>
        </div>
      </div>
    `
    )
    .join("");
}

function buildJourney(data, activeIdea) {
  const fpilotEvents = data.timeline?.events || [];
  const duration = data.workflow?.metrics?.duration_hours;
  return [
    {
      section: "section-topic",
      title: "Topic Input",
      description: data.topic?.summary || "Seeded with 2D spintronics from summary_report.md.",
      data: "Strategy + search weights",
      duration: "",
      status: "completed",
    },
    {
      section: "section-tree",
      title: "Idea Tree",
      description: `${data.tree?.nodes?.length || "--"} nodes expanded left-to-right.`,
      data: `Interactive nodes: ${data.tree?.interactive_ids?.length || "--"}`,
      duration: "",
      status: "completed",
    },
    {
      section: "section-idea",
      title: "Top Idea Selection",
      description: activeIdea?.title || "Top-ranked idea surfaced.",
      data: `Score ${activeIdea?.score ?? "--"}, Novelty ${activeIdea?.novelty ?? "--"}`,
      duration: "",
      status: "completed",
    },
    {
      section: "section-planning",
      title: "Professor Planning",
      description: data.workflow?.summary || "Professor defined rationale and steps.",
      data: `${data.workflow?.professor_steps?.length || 0} planning steps`,
      duration: "",
      status: "completed",
    },
    {
      section: "section-workflow",
      title: "Technician Workflow",
      description: "Technician decomposed the plan into executable steps.",
      data: `${data.workflow?.technician_steps?.length || 0} steps`,
      duration: "",
      status: "completed",
    },
    {
      section: "section-workflow",
      title: "FPilot Execution",
      description: `${fpilotEvents.length} FPilot prompts and analysis tasks dispatched.`,
      data: `Status: ${data.workflow?.metrics?.steps_completed ?? 0}/${data.workflow?.metrics?.steps_total ?? "--"}`,
      duration: duration ? `${duration} h sampled` : "",
      status: fpilotEvents.length ? "in_progress" : "queued",
    },
    {
      section: "section-results",
      title: "Results & Insights",
      description: "Progress recorded; next actions derived from partial completion.",
      data: "Hypothesis ready for follow-up analysis and reruns.",
      duration: "",
      status: "queued",
    },
  ];
}

function renderResults(data) {
  const grid = document.getElementById("results-grid");
  if (!grid) return;
  grid.innerHTML = `
    <div class="result-chip"><strong>Completion</strong><br>${data.workflow?.metrics?.steps_completed ?? 0} / ${
    data.workflow?.metrics?.steps_total ?? "--"
  } steps</div>
    <div class="result-chip"><strong>Duration</strong><br>${data.workflow?.metrics?.duration_hours ?? "--"} h observed</div>
    <div class="result-chip"><strong>Events</strong><br>${data.timeline?.events?.length || 0} FPilot interactions</div>
    <div class="result-chip"><strong>Next</strong><br>Resume MAE, band structure, and exchange parameter tasks.</div>
  `;
}

function setupJourneyPlayback() {
  const btn = document.getElementById("journey-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const steps = Array.from(document.querySelectorAll(".journey-step"));
    let idx = 0;
    const tick = () => {
      steps.forEach((s) => s.classList.remove("active"));
      const current = steps[idx];
      if (current) {
        current.classList.add("active");
        const sectionId = current.getAttribute("data-section");
        highlightSection(sectionId);
        current.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      idx += 1;
      if (idx < steps.length) {
        setTimeout(tick, 900);
      }
    };
    tick();
  });
}

async function bootstrap() {
  try {
    const data = await getDemoData();
    setBadge("badge-topic", data.topic?.title || "2D Spintronics");
    setBadge("badge-interactive", data.tree?.interactive_ids?.length || 0);
    setBadge(
      "badge-steps",
      data.workflow?.metrics?.steps_total || data.workflow?.technician_steps?.length || "--"
    );
    setBadge("badge-events", data.timeline?.events?.length || 0);
    setBadge("badge-duration", data.workflow?.metrics?.duration_hours ? `${data.workflow.metrics.duration_hours} h` : "--");

    renderTopic(data.topic);

    const ideaById = new Map((data.tree.nodes || []).map((n) => [n.id, n]));
    let activeIdea =
      ideaById.get(data.workflow?.selected_idea_id) ||
      data.tree.nodes.find((n) => n.interactive) ||
      data.tree.nodes[0];

    const handleSelect = (node) => {
      activeIdea = node;
      updateIdeaDetail(node);
      renderSelectedIdea(node);
      renderWorkflowSummary("#workflow-meta", data.workflow, node);
      renderJourneyTimeline("#journey-timeline", buildJourney(data, node));
      highlightSection("section-idea");
    };

    renderIdeaTree("#idea-tree", data.tree, handleSelect, activeIdea?.id);
    updateIdeaDetail(activeIdea);
    renderSelectedIdea(activeIdea);
    renderPlanning(data.workflow);
    renderWorkflowSummary("#workflow-meta", data.workflow, activeIdea);
    renderJourneyTimeline("#journey-timeline", buildJourney(data, activeIdea));
    renderTimeline("#fpilot-timeline", data.timeline?.events || []);
    renderResults(data);
    setupTreeScroll();
    setupJourneyPlayback();
  } catch (err) {
    console.error("Failed to load demo data", err);
    const detail = document.getElementById("idea-detail");
    if (detail)
      detail.textContent = "Unable to load demo data. Please open from a local server or GitHub Pages.";
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);

function setupTreeScroll() {
  const container = document.getElementById("treeContainer");
  if (!container) return;
  const leftBtn = container.querySelector(".tree-nav-left");
  const rightBtn = container.querySelector(".tree-nav-right");
  const hint = container.parentElement?.querySelector(".scroll-hint");

  const updateOverflow = () => {
    const maxScroll = container.scrollWidth - container.clientWidth;
    container.classList.toggle("overflow-right", container.scrollLeft < maxScroll - 2);
    container.classList.toggle("overflow-left", container.scrollLeft > 2);
    if (hint) {
      hint.style.display = maxScroll > 4 ? "block" : "none";
    }
  };

  updateOverflow();
  container.addEventListener("scroll", updateOverflow);
  window.addEventListener("resize", updateOverflow);

  if (leftBtn) {
    leftBtn.addEventListener("click", () =>
      container.scrollBy({ left: -240, behavior: "smooth" })
    );
  }
  if (rightBtn) {
    rightBtn.addEventListener("click", () =>
      container.scrollBy({ left: 240, behavior: "smooth" })
    );
  }

  container.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        container.scrollBy({ left: e.deltaY * 0.6 });
        e.preventDefault();
      }
    },
    { passive: false }
  );
}
