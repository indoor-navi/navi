import { v } from "convex/values";
import { query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

async function resolveVideoUrl(ctx: any, storageId?: string) {
  if (!storageId) return "";
  try {
    const publicUrl = await ctx.storage.getUrl(storageId);
    return publicUrl || "";
  } catch (storageErr) {
    console.warn(`[Storage Warning]: Could not resolve ${storageId}`);
    return "";
  }
}

function normalizeNodeLabel(label?: string) {
  return (label || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ──────────────────────────────────────────
// NEW: Building context for Groq LLM prompt
// ──────────────────────────────────────────
export const getBuildingContext = query({
  args: {},
  handler: async (ctx) => {
    const destinations = await ctx.db.query("destinations").collect();
    const floors = await ctx.db.query("floors").collect();
    const nodes = await ctx.db.query("nodes").collect();
    const qrCodes = (await ctx.db.query("qrCodes").collect()).filter((code) => code.entityType === "destination");
    const assistantConfig = await ctx.db
      .query("assistantConfig")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();

    const buildQrContent = (entityId: string, label: string) =>
      `https://navi-mauve-mu.vercel.app/continue?entityType=destination&entityId=${encodeURIComponent(entityId)}&label=${encodeURIComponent(label)}`;

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
        videoClipUrl: n.videoClipUrl,
        landmarkType: n.landmarkType,
      })),
      qrCodes: qrCodes.map((code) => ({
        ...code,
        content: code.content || buildQrContent(code.entityId, code.label),
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

    const allNodes = await ctx.db.query("nodes").collect();
    const normalizedEntranceNames = new Set([
      "main entrance",
      "main entrace",
      "main entrance reception",
      "main entrace reception",
    ]);

    let startNode = allNodes.find((node) => {
      const normalized = normalizeNodeLabel(node.label);
      return normalizedEntranceNames.has(normalized);
    }) || allNodes[0];

    if (!startNode) {
      console.error("CRITICAL: No nodes available to start navigation.");
      return null;
    }

    const normalizedStart = normalizeNodeLabel(startNode.label);
    const isUsingEntranceAlias = normalizedEntranceNames.has(normalizedStart);
    if (allNodes.length > 1 && !isUsingEntranceAlias) {
      console.warn(
        `[Wayfinding] Using fallback start node "${startNode.label}" because no main entrance node was found.`
      );
    }

    const isAlreadyAtDestination = startNode._id === matchedDestination.targetNodeId;
    if (isAlreadyAtDestination) {
      console.log("[Wayfinding]: Already at destination. Showing main entrance node slide.");
      const resolvedStartUrl = await resolveVideoUrl(ctx, startNode.videoClipUrl);

      return {
        destination: matchedDestination.name,
        slides: [{
          id: `${startNode._id}-0`,
          stepTitle: `You are at ${startNode.label}`,
          originNodeLabel: startNode.label,
          targetNodeLabel: startNode.label,
          textDirection: "",
          description: `You are already at ${startNode.label}.`,
          walkingTime: 0,
          video: resolvedStartUrl,
          isLandmark: startNode.isLandmark,
          landmarkType: startNode.landmarkType,
        }],
      };
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
      const resolvedFallbackUrl = await resolveVideoUrl(ctx, startNode.videoClipUrl);

      return {
        destination: matchedDestination.name,
        slides: [{
          id: `${startNode._id}-0`,
          stepTitle: `Start at ${startNode.label}`,
          originNodeLabel: startNode.label,
          targetNodeLabel: startNode.label,
          textDirection: "",
          description: `Starting from ${startNode.label}.`,
          walkingTime: 0,
          video: resolvedFallbackUrl,
          isLandmark: startNode.isLandmark,
          landmarkType: startNode.landmarkType,
        }],
      };
    }

    const slides: WayfindingSlide[] = [];
    const nodeSequence: Id<"nodes">[] = [startNode._id];

    for (const edge of pathEdges) {
      if (edge.fromNodeId === edge.toNodeId) continue;
      const lastNodeId = nodeSequence[nodeSequence.length - 1];
      if (edge.toNodeId !== lastNodeId) {
        nodeSequence.push(edge.toNodeId);
      }
    }

    for (let i = 0; i < nodeSequence.length; i++) {
      const nodeId = nodeSequence[i];
      const node = await ctx.db.get(nodeId);
      if (!node) continue;

      const previousNode = i > 0 ? await ctx.db.get(nodeSequence[i - 1]) : null;
      const nextNode = i < nodeSequence.length - 1 ? await ctx.db.get(nodeSequence[i + 1]) : null;
      const edgeForThisStep = i > 0 ? pathEdges[i - 1] : null;
      const isDuplicateSelfStep = previousNode?._id === node._id;

      const sourceVideoId = node.videoClipUrl || "";
      const resolvedVideoUrl = await resolveVideoUrl(ctx, sourceVideoId);

      slides.push({
        id: `${node._id}-${i}`,
        stepTitle:
          i === 0
            ? `Start at ${node.label}`
            : isDuplicateSelfStep
              ? `You are at ${node.label}`
              : nextNode
                ? `Move toward ${nextNode.label}`
                : `Arrive at ${node.label}`,
        originNodeLabel: isDuplicateSelfStep ? node.label : previousNode?.label || node.label,
        targetNodeLabel: isDuplicateSelfStep ? node.label : node.label,
        textDirection: isDuplicateSelfStep ? "" : edgeForThisStep?.textDirection || "",
        description: isDuplicateSelfStep ? `You are already at ${node.label}.` : edgeForThisStep?.audioDescription || "",
        walkingTime: isDuplicateSelfStep ? 0 : edgeForThisStep?.estimatedWalkingTime || 0,
        video: resolvedVideoUrl,
        isLandmark: node.isLandmark,
        landmarkType: node.landmarkType,
      });
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
      if (edge.fromNodeId === edge.toNodeId) continue;
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
  video: string;
  isLandmark: boolean;
  landmarkType?: string;
}