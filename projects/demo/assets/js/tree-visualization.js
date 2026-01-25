const d3 = window.d3;

function buildHierarchy(treeData) {
  const nodeMap = new Map();
  (treeData.nodes || []).forEach((n) => nodeMap.set(n.id, { ...n, children: [] }));

  nodeMap.forEach((node) => {
    if (node.parent_id && nodeMap.has(node.parent_id)) {
      nodeMap.get(node.parent_id).children.push(node);
    }
  });

  const roots = (treeData.root_ids || [])
    .map((id) => nodeMap.get(id))
    .filter(Boolean);

  return { root: { id: "root", children: roots }, nodeMap };
}

export function renderIdeaTree(containerSelector, treeData, onSelect, activeId) {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  container.innerHTML = "";
  if (!treeData || !treeData.nodes || !treeData.nodes.length) {
    container.textContent = "No idea tree data available";
    return;
  }

  const { root } = buildHierarchy(treeData);
  const maxDepth = Math.max(...treeData.nodes.map((n) => n.depth ?? 0), 1);
  const baseWidth = (maxDepth + 2) * 260;
  const width = Math.max(container.clientWidth || 900, baseWidth);
  const height = 420;
  const margin = { top: 20, right: 120, bottom: 20, left: 140 };

  const rootNode = d3.hierarchy(root);
  const treeLayout = d3.tree().size([
    height - margin.top - margin.bottom,
    width - margin.left - margin.right,
  ]);
  treeLayout(rootNode);

  d3.selectAll(".tree-tooltip").remove();
  const svg = d3
    .select(container)
    .append("svg")
    .attr("class", "tree-svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", width)
    .attr("height", height)
    .attr("role", "img");

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left}, ${margin.top})`);

  const linkPath = d3
    .linkHorizontal()
    .x((d) => d.y)
    .y((d) => d.x);

  const nodes = rootNode.descendants().filter((d) => d.data.id !== "root");
  const links = rootNode.links().filter((d) => d.target.data.id !== "root");

  g.append("g")
    .selectAll("path")
    .data(links)
    .join("path")
    .attr("class", "tree-link")
    .attr("d", linkPath)
    .attr("stroke-dasharray", "4 6")
    .attr("stroke-opacity", 0.7);

  const tooltip = d3
    .select("body")
    .append("div")
    .attr("class", "tree-tooltip")
    .style("opacity", 0);

  const nodeGroup = g
    .append("g")
    .selectAll("g.node")
    .data(nodes)
    .join("g")
    .attr("class", (d) =>
      [
        "tree-node",
        d.data.interactive || d.data.is_top ? "is-interactive" : "non-interactive",
        d.data.id === activeId ? "is-selected" : "",
      ].join(" ")
    )
    .attr("transform", (d) => `translate(${d.y},${d.x})`);

  const colorFor = (d) => {
    if (d.data.is_topic) return "#22d3ee";
    if (d.data.is_top) return "#22c55e";
    return "#7c8ba1";
  };

  nodeGroup
    .append("circle")
    .attr("r", (d) => (d.data.interactive || d.data.is_top ? 9 : 8))
    .attr("class", "tree-dot")
    .attr("fill", colorFor)
    .attr("stroke", (d) => (d.data.interactive ? "#ffffff" : "#2e3a4e"))
    .attr("stroke-width", 1.6)
    .attr("opacity", 0)
    .transition()
    .delay((d) => d.depth * 140)
    .duration(400)
    .attr("opacity", 1);

  const truncate = (text) => {
    if (!text) return "";
    const words = text.split(" ");
    return words.length > 3 ? `${words.slice(0, 3).join(" ")}...` : text;
  };

  nodeGroup
    .append("text")
    .attr("class", "node-text")
    .attr("dy", "0.35em")
    .attr("x", (d) => (d.children && d.children.length ? -14 : 14))
    .attr("text-anchor", (d) => (d.children && d.children.length ? "end" : "start"))
    .text((d) => truncate(d.data.title));

  nodeGroup
    .on("mouseenter", (event, d) => {
      const meta = `Novelty ${d.data.novelty ?? "--"} · Feasibility ${d.data.feasibility ?? "--"}`;
      tooltip
        .style("opacity", 1)
        .html(
          `<h4>${d.data.title}</h4>
           <p class="description">${d.data.summary || ""}</p>
           <p class="meta">${meta}</p>
           ${d.data.is_top ? '<div class="top-idea-badge">Top Idea</div>' : ""}`
        )
        .style("left", `${event.pageX + 12}px`)
        .style("top", `${event.pageY - 20}px`);
    })
    .on("mousemove", (event) => {
      tooltip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY - 20}px`);
    })
    .on("mouseleave", () => {
      tooltip.style("opacity", 0);
    })
    .on("click", (_, d) => {
      if (!d.data.interactive && !d.data.is_top) return;
      nodeGroup.classed("is-selected", (n) => n.data.id === d.data.id);
      onSelect?.(d.data);
    });
}
