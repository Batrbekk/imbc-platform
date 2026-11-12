// Общие компоненты прототипа: подтверждение действия, выбор файла без отправки, переписка запроса.
import { screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction, DueDiligenceBadge, FileRow, ProfileStatusBadge, RequestThread } from "@/prototype/components";
import type { FileRef } from "@/prototype/data";

import { renderRoute } from "../support/render";

/** Компонент на странице с провайдерами приложения (язык, форматы). */
function show(element: React.ReactNode, locale: "en" | "ru" | "kk" = "en") {
  return renderRoute("/", { locale, routes: [{ path: "/", element }] });
}

describe("общие компоненты прототипа", () => {
  it("ConfirmAction: действие только после подтверждения; поле в диалоге закрывает кнопку", async () => {
    const onConfirm = vi.fn();
    function WithComment() {
      const [comment, setComment] = useState("");
      return (
        <ConfirmAction label="Return" title="Return the section?" onConfirm={onConfirm} confirmDisabled={!comment}>
          <Textarea aria-label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        </ConfirmAction>
      );
    }
    const { user } = show(<WithComment />);

    await user.click(screen.getByRole("button", { name: "Return" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Return the section?" });
    const confirm = within(dialog).getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(within(dialog).getByRole("textbox", { name: "Comment" }), "Нет подписи");
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("FileRow: выбранный файл — имя, размер и время, без отправки", async () => {
    const onSelect = vi.fn<(file: FileRef) => void>();
    const { user } = show(<FileRow label="Charter" file={null} onSelect={onSelect} />);
    expect(screen.getByText("No file")).toBeTruthy();

    const fetch = vi.spyOn(globalThis, "fetch");
    await user.upload(
      screen.getByLabelText("Charter"),
      new File(["x".repeat(4096)], "charter.pdf", { type: "application/pdf" }),
    );
    expect(onSelect).toHaveBeenCalledWith({ name: "charter.pdf", sizeKb: 4, uploadedAt: expect.any(String) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("RequestThread: сообщения по порядку, пустой ответ не уходит", async () => {
    const onReply = vi.fn();
    const { user } = show(
      <RequestThread
        entries={[
          {
            id: "1",
            author: "Специалист оператора",
            meta: "Оператор (демо)",
            at: "2026-11-11T05:00:00Z",
            text: "Вопрос",
          },
        ]}
        onReply={onReply}
      />,
      "ru",
    );
    expect(screen.getByText("Вопрос")).toBeTruthy();
    expect(screen.getByText("11.11.2026, 10:00", { exact: false })).toBeTruthy();
    const send = screen.getByRole("button", { name: "Ответить" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.type(screen.getByRole("textbox", { name: "Ваше сообщение" }), "  Ответ  ");
    await user.click(send);
    expect(onReply).toHaveBeenCalledWith("Ответ");
  });

  it("бейджи переведены", () => {
    show(
      <>
        <ProfileStatusBadge status="verified" pendingChanges />
        <DueDiligenceBadge result="amber" />
      </>,
      "kk",
    );
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("Күтудегі өзгерістер")).toBeTruthy();
    expect(screen.getByText("Amber")).toBeTruthy();
  });
});
