const fs = require("fs/promises");
const path = require("path");
const { supabase } = require("./db");

const EXERCISE_DIR = path.join(__dirname, "..", "public", "js", "workout", "exercises");
const EXERCISE_FILE_SUFFIX = "-exercise.js";
const VIEW_CODES = ["FRONT", "SIDE", "DIAGONAL"];
const TARGET_TYPES = ["REPS", "TIME"];
const MANIFEST_REGEX = /\/\*\s*EXERCISE_MANIFEST\s*([\s\S]*?)\*\//;
const CODE_REGEX = /\bcode:\s*['"]([a-zA-Z0-9_-]+)['"]/;

const normalizeExerciseCode = (value) =>
    String(value || "")
        .trim()
        .toUpperCase()
        .replace(/-/g, "_");

const humanizeExerciseCode = (code) =>
    String(code || "")
        .trim()
        .toLowerCase()
        .split(/[_-]+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(" ");

const normalizeAllowedViews = (input) => {
    const rawValues = Array.isArray(input) ? input : [input];
    const normalized = rawValues
        .map((value) => String(value || "").trim().toUpperCase())
        .filter((value) => VIEW_CODES.includes(value));

    return [...new Set(normalized)];
};

const parseManifest = (text) => {
    const match = text.match(MANIFEST_REGEX);
    if (!match) return null;

    try {
        return JSON.parse(match[1].trim());
    } catch (error) {
        console.error("Exercise manifest parse failed:", error);
        return null;
    }
};

const inferCodeFromText = (fileName, text) => {
    const codeMatch = text.match(CODE_REGEX);
    if (codeMatch?.[1]) {
        return normalizeExerciseCode(codeMatch[1]);
    }

    return normalizeExerciseCode(path.basename(fileName, EXERCISE_FILE_SUFFIX));
};

const buildExerciseDefinition = (fileName, text, index) => {
    const manifest = parseManifest(text) || {};
    const inferredCode = inferCodeFromText(fileName, text);
    const code = normalizeExerciseCode(manifest.code || inferredCode);
    const allowedViews = normalizeAllowedViews(manifest.allowed_views);
    const defaultViewRaw = String(manifest.default_view || "").trim().toUpperCase();
    const defaultView = allowedViews.includes(defaultViewRaw)
        ? defaultViewRaw
        : (allowedViews[0] || "FRONT");
    const defaultTargetType = TARGET_TYPES.includes(String(manifest.default_target_type || "").trim().toUpperCase())
        ? String(manifest.default_target_type).trim().toUpperCase()
        : "REPS";
    const sortOrder = Number.isFinite(Number(manifest.sort_order))
        ? Number(manifest.sort_order)
        : ((index + 1) * 100);
    const displayName = String(manifest.name || "").trim() || humanizeExerciseCode(code);
    const description = String(manifest.description || "").trim() ||
        `${displayName} 운동 모듈이 감지되었습니다. 설정을 확인한 뒤 활성화하세요.`;

    return {
        code,
        name: displayName,
        description,
        sort_order: sortOrder,
        default_target_type: defaultTargetType,
        allowed_views: allowedViews.length > 0 ? allowedViews : ["FRONT"],
        default_view: defaultView,
        thumbnail_url: String(manifest.thumbnail_url || "").trim() || null,
        is_active: manifest.is_active === true
    };
};

const listExerciseFiles = async (directoryPath) => {
    let entries = [];

    try {
        entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
    }

    const files = [];

    for (const entry of entries) {
        const absolutePath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listExerciseFiles(absolutePath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith(EXERCISE_FILE_SUFFIX)) {
            files.push(absolutePath);
        }
    }

    return files;
};

const discoverExerciseDefinitions = async () => {
    const exerciseFiles = (await listExerciseFiles(EXERCISE_DIR))
        .sort((left, right) => left.localeCompare(right, "en"));

    return Promise.all(
        exerciseFiles.map(async (filePath, index) => {
            const text = await fs.readFile(filePath, "utf8");
            const relativePath = path.relative(EXERCISE_DIR, filePath);
            return buildExerciseDefinition(relativePath, text, index);
        })
    );
};

const loadExerciseByCode = async (code) => {
    const { data, error } = await supabase
        .from("exercise")
        .select("exercise_id, code, name, description, is_active, sort_order, default_target_type, thumbnail_url")
        .eq("code", code)
        .maybeSingle();

    if (error) throw error;
    return data || null;
};

const createExercise = async (definition) => {
    const { data, error } = await supabase
        .from("exercise")
        .insert({
            code: definition.code,
            name: definition.name,
            description: definition.description,
            is_active: definition.is_active === true,
            sort_order: definition.sort_order,
            default_target_type: definition.default_target_type,
            thumbnail_url: definition.thumbnail_url
        })
        .select("exercise_id, code, name, description, is_active, sort_order, default_target_type, thumbnail_url")
        .single();

    if (!error) {
        return data;
    }

    if (error.code !== "23505") {
        throw error;
    }

    return loadExerciseByCode(definition.code);
};

const ensureExerciseRow = async (definition) => {
    let exercise = await loadExerciseByCode(definition.code);

    if (!exercise) {
        exercise = await createExercise(definition);
    }

    if (!exercise?.exercise_id) {
        throw new Error(`Failed to resolve exercise row for ${definition.code}`);
    }

    const patch = {};

    if (!exercise.name) {
        patch.name = definition.name;
    }
    if (!exercise.description && definition.description) {
        patch.description = definition.description;
    }
    if (!exercise.default_target_type) {
        patch.default_target_type = definition.default_target_type;
    }
    if (exercise.thumbnail_url == null && definition.thumbnail_url) {
        patch.thumbnail_url = definition.thumbnail_url;
    }

    if (Object.keys(patch).length > 0) {
        const { error } = await supabase
            .from("exercise")
            .update({
                ...patch,
                updated_at: new Date().toISOString()
            })
            .eq("exercise_id", exercise.exercise_id);

        if (error) throw error;
    }

    return exercise;
};

const ensureAllowedViews = async (exerciseId, definition) => {
    const { data: existingViews, error: viewError } = await supabase
        .from("exercise_allowed_view")
        .select("view_code, is_default")
        .eq("exercise_id", exerciseId);

    if (viewError) throw viewError;

    if (Array.isArray(existingViews) && existingViews.length > 0) {
        return;
    }

    const rows = definition.allowed_views.map((viewCode) => ({
        exercise_id: exerciseId,
        view_code: viewCode,
        is_default: viewCode === definition.default_view
    }));

    const { error } = await supabase
        .from("exercise_allowed_view")
        .insert(rows);

    if (error) throw error;
};

const syncExerciseCatalog = async () => {
    const definitions = await discoverExerciseDefinitions();

    for (const definition of definitions) {
        const exercise = await ensureExerciseRow(definition);
        await ensureAllowedViews(exercise.exercise_id, definition);
    }

    return definitions;
};

module.exports = {
    syncExerciseCatalog,
    discoverExerciseDefinitions
};
