"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import type { TeacherQuestionOverview } from "@/lib/types";
import { ErrorNotice, Loading, Notice, StatBox } from "@/components/ui";

const QUICK_ACTIONS = [
  { href: "/teacher/questions", label: "題目管理、處理回報" },
  { href: "/teacher/questions/generate", label: "生成題目並審核" },
  { href: "/teacher/records", label: "查看／下載學生練習記錄" },
  { href: "/", label: "學生端測試（以教師身分練習）" },
];

/**
 * 教師端首頁：只顯示出題相關（題庫、回報）及學生練習記錄的概況。
 * 教材、OCR、課題發布及系統狀態屬管理員職能，已移至管理員端。
 */
export function TeacherDashboard({ teacherEmail }: { teacherEmail?: string | null }) {
  const [overview, setOverview] = useState<TeacherQuestionOverview | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<TeacherQuestionOverview>("/api/teacher/overview")
      .then((result) => {
        if (!cancelled) {
          setOverview(result);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNotice error={error} />;
  if (!overview) return <Loading label="正在載入教師端資料…" />;

  const { questions, records } = overview;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">教師端</h1>
        <span className="text-sm text-gray-600">
          {teacherEmail ? `已登入：${teacherEmail}` : "未啟用登入（本機示範模式）"}
        </span>
      </div>

      <Notice tone="info">
        教師端提供出題相關功能（題目管理、生成題目、回覆學生回報）及查看／下載學生練習記錄。
        教材管理、OCR、課題發布及系統狀態屬管理員職能，請聯絡管理員處理。
      </Notice>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">題庫概況</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatBox label="題庫題目" value={`${questions.total}`} />
          <StatBox label="已發布題目" value={`${questions.published}`} />
          <StatBox label="草稿題目" value={`${questions.draft}`} />
          <StatBox label="已停用題目" value={`${questions.disabled}`} />
          <StatBox label="校內試題（待核對）" value={`${questions.schoolPaper}`} />
          <StatBox label="未通過教材核對" value={`${questions.unverified}`} />
          <StatBox label="題目待覆核回報" value={`${questions.flagged}`} />
        </div>
        <p className="text-sm text-gray-600">
          校內試題匯入後一律為草稿，需教師核對後才發布給學生；未通過教材依據核對的題目{" "}
          {questions.unverified} 題（校內試題的來源是試卷本身，不需教材依據核對，因此不計入）。
        </p>
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">學生練習記錄</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatBox label="練習次數" value={`${records.sessions}`} />
          <StatBox label="有記錄的學習者" value={`${records.learners}`} />
        </div>
        <p className="text-sm text-gray-600">
          學生的練習記錄會自動留檔（包含作答日期、課題、題型及答對／答錯的題目），
          教師可在「學習記錄」頁查閱及下載 CSV。
        </p>
        <div>
          <Link href="/teacher/records" className="btn btn-primary">
            查看學習記錄
          </Link>
        </div>
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">常用操作</h2>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.href} href={action.href} className="btn">
              {action.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
