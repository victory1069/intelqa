"use client";
import { useCallback, useEffect, useState } from "react";
import { odb, type CourseBundle, type OfflineAttempt } from "./offline";
import { DOWNLOADS_EVENT } from "./start";

/** Courses saved on this phone. */
export function useDownloads() {
  const [courses, setCourses] = useState<CourseBundle[] | null>(null);
  const load = useCallback(() => odb().courses.toArray().then(setCourses).catch(() => setCourses([])), []);
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    // Fired after each paper is saved, including background "download when online" runs.
    window.addEventListener(DOWNLOADS_EVENT, load);
    return () => {
      window.removeEventListener("focus", load);
      window.removeEventListener(DOWNLOADS_EVENT, load);
    };
  }, [load]);
  return { courses, reload: load, has: (id: string) => !!courses?.some((c) => c.courseId === id) };
}

/** Offline sessions finished but not yet synced. */
export function usePendingSync() {
  const [rows, setRows] = useState<OfflineAttempt[]>([]);
  useEffect(() => {
    const load = () => odb().offlineAttempts.toArray().then((a) => setRows(a.filter((x) => x.submittedAt && !x.synced))).catch(() => {});
    load();
    window.addEventListener("online", load);
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener("online", load);
      window.removeEventListener("focus", load);
    };
  }, []);
  return rows;
}
