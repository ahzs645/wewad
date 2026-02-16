import { useCallback, useEffect, useState } from "react";
import { clearRecentWads, getRecentWad, listRecentWads } from "../utils/recentWads";

export function useRecentWads(handleFile, isProcessing) {
  const [recentWads, setRecentWads] = useState([]);
  const [isLoadingRecentId, setIsLoadingRecentId] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entries = await listRecentWads();
        if (!cancelled) {
          setRecentWads(entries);
        }
      } catch {
        if (!cancelled) {
          setRecentWads([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadRecentWad = useCallback(
    async (recentWadId) => {
      if (!recentWadId || isProcessing) {
        return;
      }

      setIsLoadingRecentId(recentWadId);
      try {
        const row = await getRecentWad(recentWadId);
        if (!row?.blob) {
          setRecentWads(await listRecentWads());
          return;
        }

        const canUseFileConstructor = typeof File !== "undefined";
        const hasFileType = canUseFileConstructor && row.blob instanceof File;
        const file =
          hasFileType
            ? row.blob
            : canUseFileConstructor
              ? new File([row.blob], row.name ?? "recent.wad", {
                  lastModified: Number(row.lastModified ?? Date.now()),
                  type: row.blob.type || "application/octet-stream",
                })
              : {
                  name: row.name ?? "recent.wad",
                  arrayBuffer: () => row.blob.arrayBuffer(),
                  size: Number(row.size ?? 0),
                  lastModified: Number(row.lastModified ?? 0),
                };

        await handleFile(file);
      } finally {
        setIsLoadingRecentId("");
      }
    },
    [handleFile, isProcessing],
  );

  const clearRecentWadsList = useCallback(async () => {
    await clearRecentWads();
    setRecentWads([]);
  }, []);

  return { recentWads, setRecentWads, isLoadingRecentId, loadRecentWad, clearRecentWadsList };
}
