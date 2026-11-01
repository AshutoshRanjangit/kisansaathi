"""LangGraph state machine:

planner → locate ─(not found)→ synthesize
                 └→ fetch_data (weather ∥ mandi) → resolve_commodity
                        ├(no match)→ expand_states → resolve_commodity   [self-correction]
                        └→ geocode_mandis → rank_markets
                                 ├(<3 mandis)→ widen_radius → rank_markets [self-correction]
                                 └→ engine → synthesize → guardrail → END
"""
from langgraph.graph import END, START, StateGraph

from agent import nodes
from agent.state import AgentState

NODE_LABELS = {
    "planner": "Planner (LLM)\nreads conversation",
    "check_slots": "Know crop, place,\ntransport?",
    "ask_farmer": "Ask the farmer\n(one question)",
    "locate": "Geocode farmer",
    "fetch_data": "Parallel fetch\nweather ∥ mandi",
    "resolve_commodity": "Verify commodity",
    "expand_states": "Self-correct:\nneighbour states",
    "geocode_mandis": "Geocode mandis",
    "rank_markets": "Rank by net price",
    "widen_radius": "Self-correct:\nwiden radius",
    "engine": "Deterministic engine\nVPD · ET₀ · soil · ₹",
    "synthesize": "Synthesizer (LLM)",
    "guardrail": "Guardrail verifier",
}
EDGES = [
    ("planner", "check_slots"), ("check_slots", "ask_farmer"), ("check_slots", "locate"), ("locate", "fetch_data"), ("locate", "synthesize"),
    ("fetch_data", "resolve_commodity"), ("resolve_commodity", "geocode_mandis"),
    ("resolve_commodity", "expand_states"), ("expand_states", "resolve_commodity"),
    ("resolve_commodity", "engine"), ("geocode_mandis", "rank_markets"),
    ("rank_markets", "widen_radius"), ("widen_radius", "rank_markets"), ("rank_markets", "engine"),
    ("engine", "synthesize"), ("synthesize", "guardrail"),
]


def build_graph():
    g = StateGraph(AgentState)
    g.add_node("planner", nodes.planner)
    g.add_node("locate", nodes.locate)
    g.add_node("fetch_data", nodes.fetch_data)
    g.add_node("resolve_commodity", nodes.resolve_commodity)
    g.add_node("expand_states", nodes.expand_states)
    g.add_node("geocode_mandis", nodes.geocode_mandis)
    g.add_node("rank_markets", nodes.rank_markets)
    g.add_node("widen_radius", nodes.widen_radius)
    g.add_node("engine", nodes.run_engine)
    g.add_node("synthesize", nodes.synthesize)
    g.add_node("guardrail", nodes.guardrail)

    g.add_edge(START, "planner")
    g.add_node("check_slots", nodes.check_slots)
    g.add_node("ask_farmer", nodes.ask_farmer)
    g.add_edge("planner", "check_slots")
    g.add_conditional_edges("check_slots", nodes.route_slots, {"ask_farmer": "ask_farmer", "locate": "locate"})
    g.add_edge("ask_farmer", END)
    g.add_conditional_edges("locate", nodes.route_location, {"fetch_data": "fetch_data", "synthesize": "synthesize"})
    g.add_edge("fetch_data", "resolve_commodity")
    g.add_conditional_edges("resolve_commodity", nodes.route_commodity,
                            {"geocode_mandis": "geocode_mandis", "expand_states": "expand_states", "engine": "engine"})
    g.add_edge("expand_states", "resolve_commodity")
    g.add_edge("geocode_mandis", "rank_markets")
    g.add_conditional_edges("rank_markets", nodes.route_rank, {"widen_radius": "widen_radius", "engine": "engine"})
    g.add_edge("widen_radius", "rank_markets")
    g.add_edge("engine", "synthesize")
    g.add_edge("synthesize", "guardrail")
    g.add_edge("guardrail", END)
    return g.compile()


def to_dot(visited: list[str]) -> str:
    seen = set(visited)
    lines = ['digraph G { rankdir=TB; bgcolor="transparent"; node [shape=box style="rounded,filled" '
             'fontname="Helvetica" fontsize=10 penwidth=1.2]; edge [color="#9aa5b1"];']
    for key, label in NODE_LABELS.items():
        if key in seen:
            fill, font, border = ("#f59e0b", "#1f2937", "#b45309") if key in ("expand_states", "widen_radius") \
                else ("#16a34a", "white", "#166534")
        else:
            fill, font, border = "#f3f4f6", "#6b7280", "#d1d5db"
        lines.append(f'"{key}" [label="{label}" fillcolor="{fill}" fontcolor="{font}" color="{border}"];')
    for a, b in EDGES:
        hot = a in seen and b in seen
        style = 'color="#16a34a" penwidth=2' if hot else ""
        lines.append(f'"{a}" -> "{b}" [{style}];')
    lines.append("}")
    return "\n".join(lines)
