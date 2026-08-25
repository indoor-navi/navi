import { v } from "convex/values";
import { query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

// ──────────────────────────────────────────
// NEW: Building context for Groq LLM prompt
// ──────────────────────────────────────────
export const getBuildingContext = query({
  args: {},
  handler: async (ctx) => {
    const destinations = await ctx.db.query("destinations").collect();
    const floors = await ctx.db.query("floors").collect();
    const nodes = await ctx.db.query("nodes").collect();
    const qrCodes = await ctx.db.query("qrCodes").collect();
    const assistantConfig = await ctx.db
      .query("assistantConfig")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();

    const buildQrContent = (entityType: "node" | "destination", entityId: string, label: string) =>
      `https://navi-mauve-mu.vercel.app/continue?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}&label=${encodeURIComponent(label)}`;
    
    return {
      destinations: destinations.map((d) => ({
        _id: d._id,
        name: d.name,
        aliases: d.aliases,
        floorId: d.floorId,
        description: d.description,
      })),
      floors: floors.map((f) => ({
        _id: f._id,
        name: f.name,
        level: f.level,
      })),
      nodes: nodes.map((n) => ({
        _id: n._id,
        label: n.label,
        floorId: n.floorId,
        isLandmark: n.isLandmark,
        landmarkType: n.landmarkType,
      })),
      qrCodes: qrCodes.map((code) => ({
        ...code,
        content: code.content || buildQrContent(code.entityType, code.entityId, code.label),
      })),
      assistantConfig,
      totalNodes: nodes.length,
    };
  },
});

// ──────────────────────────────────────────
// EXISTING: Wayfinding BFS engine
// ──────────────────────────────────────────
export const getWayfindingSequence = query({
  args: {
    transcriptInput: v.string(),
  },
  handler: async (ctx, args) => {
    const searchIntent = args.transcriptInput.trim().toLowerCase();
    if (!searchIntent) return null;

    const allDestinations = await ctx.db.query("destinations").collect();
    const matchedDestination = allDestinations.find((dest) => {
      const normalizedName = (dest.name || "").toLowerCase();
      const nameMatch =
        searchIntent.includes(normalizedName) ||
        normalizedName.includes(searchIntent);

      const aliasMatch =
        Array.isArray(dest.aliases) &&
        dest.aliases.some((alias) => {
          const normalizedAlias = (alias || "").toLowerCase();
          return (
            searchIntent.includes(normalizedAlias) ||
            normalizedAlias.includes(searchIntent)
          );
        });

      return nameMatch || aliasMatch;
    });

    if (!matchedDestination) {
      console.log(`[Wayfinding] No match for: "${searchIntent}"`);
      return null;
    }

    let startNode = await ctx.db
      .query("nodes")
      .filter((q) => q.eq(q.field("label"), "Main Entrance Reception"))
      .first();

    if (!startNode) {
      console.error("CRITICAL: Anchor node 'Main Entrance Reception' missing!");
      return null;
    }

    if (startNode._id === matchedDestination.targetNodeId) {
      console.log("[Wayfinding]: Already at destination.");
      return null;
    }

    const pathEdges = await findShortestPath(
      ctx,
      startNode._id,
      matchedDestination.targetNodeId
    );

    if (!pathEdges || pathEdges.length === 0) {
      console.error(
        `[Graph Error]: No path to "${matchedDestination.name}"`
      );
      return null;
    }

    const slides: WayfindingSlide[] = [];

    for (let i = 0; i < pathEdges.length; i++) {
      const edge = pathEdges[i];
      const fromNode = await ctx.db.get(edge.fromNodeId);
      const toNode = await ctx.db.get(edge.toNodeId);

      if (fromNode && toNode) {
        let resolvedImageUrl = "";
        if (edge.imageUrl) {
          try {
            const publicUrl = await ctx.storage.getUrl(edge.imageUrl);
            if (publicUrl) resolvedImageUrl = publicUrl;
          } catch (storageErr) {
            console.warn(
              `[Storage Warning]: Could not resolve ${edge.imageUrl}`
            );
          }
        }

        slides.push({
          id: edge._id,
          stepTitle: `Step ${i + 1}: Move toward ${toNode.label}`,
          originNodeLabel: fromNode.label,
          targetNodeLabel: toNode.label,
          textDirection: edge.textDirection,
          description: edge.audioDescription,
          walkingTime: edge.estimatedWalkingTime,
          image: resolvedImageUrl,
          isLandmark: toNode.isLandmark,
          landmarkType: toNode.landmarkType,
        });
      }
    }

    return {
      destination: matchedDestination.name,
      slides: slides,
    };
  },
});

// ──────────────────────────────────────────
// Helper: BFS shortest path
// ──────────────────────────────────────────
async function findShortestPath(
  ctx: any,
  startNodeId: Id<"nodes">,
  targetNodeId: Id<"nodes">
): Promise<Doc<"connections">[] | null> {
  const queue: { currentNodeId: Id<"nodes">; path: Doc<"connections">[] }[] = [
    { currentNodeId: startNodeId, path: [] },
  ];
  const visited = new Set<string>([startNodeId]);

  while (queue.length > 0) {
    const currentItem = queue.shift();
    if (!currentItem) continue;

    const { currentNodeId, path } = currentItem;

    if (currentNodeId === targetNodeId) {
      return path;
    }

    const outgoingEdges = await ctx.db
      .query("connections")
      .withIndex("by_fromNode", (q: any) =>
        q.eq("fromNodeId", currentNodeId)
      )
      .collect();

    for (const edge of outgoingEdges) {
      if (!visited.has(edge.toNodeId)) {
        visited.add(edge.toNodeId);
        queue.push({
          currentNodeId: edge.toNodeId,
          path: [...path, edge],
        });
      }
    }
  }

  return null;
}

// Type used internally
interface WayfindingSlide {
  id: string;
  stepTitle: string;
  originNodeLabel: string;
  targetNodeLabel: string;
  textDirection: string;
  description: string;
  walkingTime: number;
  image: string;
  isLandmark: boolean;
  landmarkType?: string;
}