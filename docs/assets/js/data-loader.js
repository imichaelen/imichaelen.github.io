export async function getDemoData() {
  if (window.demoData) {
    return window.demoData;
  }

  const fetchJson = async (path) => {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Unable to load ${path}`);
    return res.json();
  };

  const [tree, ideas, workflow, timeline] = await Promise.all([
    fetchJson("demo_data/sanitized_tree.json"),
    fetchJson("demo_data/sanitized_ideas.json"),
    fetchJson("demo_data/sanitized_workflow.json"),
    fetchJson("demo_data/fpilot_interactions.json"),
  ]);

  const bundled = { tree, ideas, workflow, timeline };
  window.demoData = bundled;
  return bundled;
}
