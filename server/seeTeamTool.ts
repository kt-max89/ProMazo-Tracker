import type { IStorage } from "./storage";
import type { SeeTeamArgs } from "./toolIntentSelector";
import { listTeamPosts } from "./teamPostService";
import { listReflections, reflectionAccess, type ReflectionViewer } from "./reflectionService";
import { reflectionFieldLabels } from "@shared/schema";
import { getSprint, getTrackerSettings, listSprints } from "./sprintService";

export type SeeTeamResult = {
  content: string;
  isEmpty: boolean;
  suggestRetry?: string;
};

type TeamToolSources = {
  listPosts: typeof listTeamPosts;
  listSprintReflections: typeof listReflections;
  listTrackerSprints: typeof listSprints;
  getSettings: typeof getTrackerSettings;
  getReflectionAccess: typeof reflectionAccess;
};

const defaultSources: TeamToolSources = {
  listPosts: listTeamPosts,
  listSprintReflections: listReflections,
  listTrackerSprints: listSprints,
  getSettings: getTrackerSettings,
  getReflectionAccess: reflectionAccess,
};

export async function runSeeTeamTool(
  args: SeeTeamArgs,
  storage: IStorage,
  viewer: ReflectionViewer,
  sourceOverrides: Partial<TeamToolSources> = {},
): Promise<SeeTeamResult> {
  const sources = { ...defaultSources, ...sourceOverrides };
  const include = new Set(args.include?.length ? args.include : ["people"]);
  const limit = Math.min(Math.max(1, args.limit ?? 5), 10);
  const needsSprintMetadata =
    include.has("sprint") || args.sprintNumber != null || args.currentSprint === true;

  const [usersSource, postsSource, reflectionsSource, sprintsSource, settingsSource, accessSource] = await Promise.all([
    settleSource(include.has("people") || Boolean(args.person), () => storage.getAllUsers(), []),
    settleSource(include.has("updates"), () => sources.listPosts(true), []),
    settleSource(include.has("reflections"), () => sources.listSprintReflections(viewer), []),
    settleSource(needsSprintMetadata, () => sources.listTrackerSprints(), []),
    settleSource(include.has("sprint") || args.currentSprint === true, () => sources.getSettings(), undefined),
    settleSource(include.has("reflections"), () => sources.getReflectionAccess(viewer), []),
  ]);
  const users = usersSource.value;
  const posts = postsSource.value;
  const reflections = reflectionsSource.value;
  const sprints = sprintsSource.value;
  const settings = settingsSource.value;

  const person = args.person?.toLowerCase();
  const query = args.query?.toLowerCase();
  const sprintById = new Map(sprints.map(sprint => [sprint.id, sprint]));
  const requestedSprint = args.sprintNumber == null
    ? undefined
    : sprints.find(sprint => sprint.number === args.sprintNumber);
  const currentSprint = settings?.currentSprintId == null
    ? undefined
    : sprintById.get(settings.currentSprintId);

  const parts: string[] = [];
  let resultCount = 0;

  if (include.has("sprint")) {
    parts.push("=== CURRENT SPRINT (live tracker data) ===");
    if (sprintsSource.error || settingsSource.error) {
      parts.push(`Source unavailable: ${sprintsSource.error ?? settingsSource.error}`);
    } else if (currentSprint) {
      parts.push(`Sprint ${currentSprint.number} (ID ${currentSprint.id})`);
      resultCount++;
    } else {
      parts.push("No current sprint is configured.");
    }
  }

  if (include.has("people")) {
    const matchingUsers = users
      .filter(user => !person || user.displayName.toLowerCase().includes(person))
      .slice(0, limit);
    parts.push("=== TEAM ROSTER (live data) ===");
    if (usersSource.error) {
      parts.push(`Source unavailable: ${usersSource.error}`);
    } else if (matchingUsers.length === 0) {
      parts.push("No matching people found.");
    } else {
      for (const user of matchingUsers) parts.push(`- ${user.displayName} (${user.role})`);
      resultCount += matchingUsers.length;
    }
  }

  if (include.has("updates")) {
    const matchingPosts = posts
      .filter(post => !person || (post.authorName ?? "").toLowerCase().includes(person))
      .filter(post => !query || post.body.toLowerCase().includes(query))
      .slice(0, limit);
    parts.push("=== TEAM OVERVIEW UPDATES (live data) ===");
    if (postsSource.error) {
      parts.push(`Source unavailable: ${postsSource.error}`);
    } else if (matchingPosts.length === 0) {
      parts.push("No matching Team Overview updates found.");
    } else {
      for (const post of matchingPosts) {
        parts.push(`- ${post.createdAt.slice(0, 10)} — ${post.authorName ?? "Former team member"}${post.pinned ? " (pinned)" : ""}: ${post.body.slice(0, 500)}`);
      }
      resultCount += matchingPosts.length;
    }
  }

  if (include.has("reflections")) {
    const sprintId = args.currentSprint
      ? currentSprint?.id
      : requestedSprint?.id;
    const impossibleSprintFilter =
      (args.currentSprint && !currentSprint) ||
      (args.sprintNumber != null && !requestedSprint) ||
      (args.currentSprint && requestedSprint && currentSprint?.id !== requestedSprint.id);
    const matchingReflections = impossibleSprintFilter
      ? []
      : reflections
          .filter(reflection => sprintId == null || reflection.sprintId === sprintId)
          .filter(reflection => !person || reflection.authorName.toLowerCase().includes(person))
          .filter(reflection => {
            if (!query) return true;
            return [
              reflection.summary,
              reflection.kaizenWhat,
              reflection.kaizenWhy,
              reflection.kaizenDone,
              reflection.impact,
              ...reflection.wastes.map(waste => waste.description),
              ...(reflection.additions ?? []).map(item => item.text),
            ].some(value => value.toLowerCase().includes(query));
          })
          .slice(0, limit);
    const reflectionSourceError =
      reflectionsSource.error ??
      (args.currentSprint ? (settingsSource.error ?? sprintsSource.error) : undefined) ??
      (args.sprintNumber != null ? sprintsSource.error : undefined);
    parts.push("=== SPRINT REFLECTIONS (live data) ===");
    if (accessSource.error) {
      parts.push(`Access status unavailable: ${accessSource.error}`);
    } else {
      const locked = accessSource.value.filter(access => !access.canRead && (sprintId == null || access.sprintId === sprintId));
      for (const access of locked) {
        parts.push(`Sprint ${access.sprintNumber}: Submit your own valid reflection for this sprint before viewing other people's reflections.`);
      }
    }
    if (reflectionSourceError) {
      parts.push(`Source unavailable: ${reflectionSourceError}`);
    } else if (matchingReflections.length === 0) {
      parts.push("No matching sprint reflections found.");
    } else {
      for (const reflection of matchingReflections) {
        parts.push(
          `### Sprint ${reflection.sprintNumber} — ${reflection.authorName}`,
          `Summary: ${reflection.summary}`,
          `Kaizen: ${reflection.kaizenWhat}`,
          `Why: ${reflection.kaizenWhy}`,
          `Done: ${reflection.kaizenDone}`,
          `Impact: ${reflection.impact}`,
          `Wastes: ${reflection.wastes.map(waste => `${waste.category}: ${waste.description}`).join("; ")}`,
          ...(reflection.additions ?? []).map(item =>
            `Addition ${item.createdAt} — ${item.authorName} — ${reflectionFieldLabels[item.field]}${item.wasteIndex != null ? ` #${item.wasteIndex + 1}` : item.wasteAdditionId != null ? ` (new waste ${item.wasteAdditionId})` : ""}${item.category ? ` (${item.category})` : ""}: ${item.text}`),
        );
      }
      resultCount += matchingReflections.length;
    }
  }

  return {
    content: parts.join("\n"),
    isEmpty: resultCount === 0,
    suggestRetry: resultCount === 0
      ? "No matching team context was found. Should we broaden the person, sprint, or text filters?"
      : undefined,
  };
}

type SettledSource<T> = {
  value: T;
  error?: string;
};

async function settleSource<T>(
  enabled: boolean,
  load: () => Promise<T>,
  fallback: T,
): Promise<SettledSource<T>> {
  if (!enabled) return { value: fallback };
  try {
    return { value: await load() };
  } catch (error) {
    return {
      value: fallback,
      error: error instanceof Error ? error.message : "Unknown source error",
    };
  }
}