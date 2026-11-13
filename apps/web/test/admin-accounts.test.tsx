// Кабинет администратора: организации и аккаунты (ADM-01, ADM-02, ADM-03, ADM-05, ADM-06, GEN-05, AUTH-06).
import { ADMIN_PROBLEM_CODES, type AdminAccount, type AdminAccounts } from "@imbc/contracts";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import { ADMIN_PROBLEM_MESSAGES } from "@/routes/app/admin-actions";
import type { Me } from "@/lib/session";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { type ApiReply, problem, stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const ADMIN: Me = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "admin@imbc.local",
    fullName: "Администратор IMBC",
    role: "administrator",
    organizationId: "00000000-0000-4000-8000-000000000002",
    organizationType: "imbc",
    locale: "kk",
  },
  gates: { mfa: true, responsibility: true },
  homePath: "/admin/accounts",
  otpDelivery: "email",
};

const IMBC_ID = "00000000-0000-4000-8000-000000000002";
const OPERATOR_ID = "00000000-0000-4000-8000-000000000010";
const OBSERVER_ID = "00000000-0000-4000-8000-000000000020";
const EXPERT_ID = "00000000-0000-4000-8000-000000000003";
const OPERATOR_ACCOUNT_ID = "00000000-0000-4000-8000-000000000011";
const MAKER_ID = "00000000-0000-4000-8000-000000000041";

const ACCOUNTS: AdminAccounts = {
  imbcMailbox: null,
  organizations: [
    {
      id: IMBC_ID,
      name: "IMBC",
      type: "imbc",
      isMajorOperator: false,
      accounts: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          email: "admin@imbc.local",
          // Имя не совпадает с подписью роли «Администратор IMBC».
          fullName: "Демо Администратор",
          role: "administrator",
          state: "active",
          // 08:30 UTC — 13:30 в Алматы.
          lastSignInAt: "2026-11-12T08:30:00Z",
        },
        {
          id: EXPERT_ID,
          email: "expert@imbc.local",
          fullName: null,
          role: "expert",
          state: "invited",
          lastSignInAt: null,
        },
      ],
    },
    {
      id: OPERATOR_ID,
      name: "Оператор (демо)",
      type: "operator",
      isMajorOperator: true,
      accounts: [
        {
          id: OPERATOR_ACCOUNT_ID,
          email: "operator@operator.local",
          fullName: "Специалист оператора",
          role: "operator",
          state: "blocked",
          lastSignInAt: null,
        },
      ],
    },
    {
      id: OBSERVER_ID,
      name: "Наблюдатель (демо)",
      type: "observer",
      isMajorOperator: false,
      accounts: [
        {
          id: "00000000-0000-4000-8000-000000000021",
          email: "observer@observer.local",
          fullName: "Наблюдатель",
          role: "observer",
          state: "inactive",
          lastSignInAt: null,
        },
      ],
    },
    {
      id: "00000000-0000-4000-8000-000000000030",
      name: "ТОО «Демо Агро Өнім»",
      type: "manufacturer",
      isMajorOperator: false,
      accounts: [],
    },
    {
      id: "00000000-0000-4000-8000-000000000040",
      name: "ТОО «Станок»",
      type: "manufacturer",
      isMajorOperator: false,
      accounts: [
        {
          id: MAKER_ID,
          email: "maker@maker.local",
          fullName: "Производитель",
          role: "manufacturer",
          state: "active",
          // 04:00 UTC — 09:00 в Алматы.
          lastSignInAt: "2026-11-10T04:00:00Z",
        },
      ],
    },
  ],
};

const ACCOUNTS_PATH = "/api/v1/admin/accounts";

const accountOf = (id: string): AdminAccount =>
  ACCOUNTS.organizations.flatMap((o) => o.accounts).find((a) => a.id === id)!;

/** Подменённый BFF администратора: /me, список и маршруты действий (по умолчанию — успех). */
function stubAdmin(handlers: Record<string, ApiReply> = {}, accounts: unknown = ACCOUNTS) {
  return stubApi({
    "GET /api/auth/me": { body: ADMIN },
    [`GET ${ACCOUNTS_PATH}`]: { body: accounts },
    ...handlers,
  });
}

const listCalls = (api: Mock<typeof fetch>) =>
  api.mock.calls.filter(([url, init]) => String(url) === ACCOUNTS_PATH && (init?.method ?? "GET") === "GET");

/** Тела запросов метода к пути, в порядке отправки. */
const sent = (api: Mock<typeof fetch>, method: string, path: string) =>
  api.mock.calls
    .filter(([url, init]) => String(url) === path && init?.method === method)
    .map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : undefined));

/** Подстановка `{name}` в текст сообщения, как это делает use-intl. */
const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

/** Карточки организаций (у ящика IMBC — своя карточка без таблицы). */
const cards = () => [...document.querySelectorAll<HTMLElement>('[data-slot="card"]')];
/** Карточка по заголовку. */
const cardOf = (name: string) =>
  cards().find((c) => c.querySelector('[data-slot="card-title"]')?.textContent === name)!;
/** Тип организации — первая часть подписи под названием. */
const typeOf = (name: string) => cardOf(name).querySelector('[data-slot="card-description"] span')?.textContent;
/** Строка аккаунта по email. */
const rowOf = (email: string) => document.querySelector<HTMLElement>(`[role="listitem"][data-account="${email}"]`)!;
const row = (email: string) => within(rowOf(email));

type Messages = typeof en;

/** Кнопка меню действий строки. */
const menuButton = (m: Messages, email: string) =>
  screen.getByRole("button", { name: fill(m.adminAccounts.actions, { email }) });

/** Открывает меню действий строки и возвращает подписи пунктов. */
async function openMenu(user: UserEvent, m: Messages, email: string) {
  await user.click(menuButton(m, email));
  const menu = await screen.findByRole("menu");
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
}

async function closeMenu(user: UserEvent) {
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}

/** Выбор варианта в Select по имени поля. */
async function choose(user: UserEvent, field: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
}

const options = async (user: UserEvent, field: string) => {
  await user.click(screen.getByRole("combobox", { name: field }));
  const list = await screen.findAllByRole("option");
  const labels = list.map((o) => o.textContent);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  return labels;
};

describe("организации и аккаунты администратора (ADM-02)", () => {
  it("организации по типам, роли и состояния переведены", async () => {
    stubAdmin();
    renderRoute("/admin/accounts", { locale: "ru" });

    expect(await screen.findByRole("heading", { level: 1, name: ru.adminAccounts.title })).toBeTruthy();
    expect(document.title).toBe(`${ru.adminAccounts.title} · ${ru.common.appName}`);
    await screen.findByText("Оператор (демо)");
    // Карточки — ящик IMBC, затем организации в порядке ответа: по типу, затем по имени.
    expect([...document.querySelectorAll('[data-slot="card-title"]')].map((title) => title.textContent)).toEqual([
      ru.adminAccounts.imbcMailbox,
      "IMBC",
      "Оператор (демо)",
      "Наблюдатель (демо)",
      "ТОО «Демо Агро Өнім»",
      "ТОО «Станок»",
    ]);
    expect(typeOf("IMBC")).toBe(ru.adminAccounts.typeValue.imbc);
    expect(typeOf("Оператор (демо)")).toBe(ru.adminAccounts.typeValue.operator);
    expect(typeOf("Наблюдатель (демо)")).toBe(ru.adminAccounts.typeValue.observer);
    expect(typeOf("ТОО «Демо Агро Өнім»")).toBe(ru.adminAccounts.typeValue.manufacturer);
    // Бейдж только у крупного оператора.
    expect(within(cardOf("Оператор (демо)")).getByText(ru.adminAccounts.majorOperator)).toBeTruthy();
    expect(screen.getAllByText(ru.adminAccounts.majorOperator)).toHaveLength(1);

    // Сколько аккаунтов — в подписи карточки.
    expect(cardOf("IMBC").querySelector('[data-slot="card-description"]')?.textContent).toBe(
      `${ru.adminAccounts.typeValue.imbc} · 2 аккаунта`,
    );
    // Строка: почта, имя и роль (roles.*), состояние (adminAccounts.stateValue.*) с пояснением, последний вход.
    const state = ru.adminAccounts.stateValue;
    const never = fill(ru.adminAccounts.lastSignInAt, { date: ru.adminAccounts.never });
    expect(
      within(cardOf("IMBC"))
        .getAllByRole("listitem")
        .map((item) => item.dataset.account),
    ).toEqual(["admin@imbc.local", "expert@imbc.local"]);
    const parts = (email: string) =>
      [
        ...rowOf(email).querySelectorAll(
          '[data-slot="item-title"], [data-slot="item-description"], [data-slot="badge"], span.text-xs, p.text-xs',
        ),
      ].map((el) => el.textContent);
    // Своя строка отмечена «Вы»: меню действий у неё нет.
    expect(parts("admin@imbc.local")).toEqual([
      `admin@imbc.local${ru.adminAccounts.you}`,
      ru.adminAccounts.you,
      `Демо Администратор · ${ru.roles.administrator}`,
      state.active,
      fill(ru.adminAccounts.lastSignInAt, { date: "12.11.2026, 13:30" }),
    ]);
    expect(within(rowOf("expert@imbc.local")).queryByText(ru.adminAccounts.you)).toBeNull();
    expect(parts("expert@imbc.local")).toEqual([
      "expert@imbc.local",
      ru.roles.expert,
      state.invited,
      ru.adminAccounts.stateHint.invited,
      never,
    ]);
    expect(parts("operator@operator.local")).toEqual([
      "operator@operator.local",
      `Специалист оператора · ${ru.roles.operator}`,
      state.blocked,
      ru.adminAccounts.stateHint.blocked,
      never,
    ]);
    expect(parts("observer@observer.local")).toEqual([
      "observer@observer.local",
      `Наблюдатель · ${ru.roles.observer}`,
      state.inactive,
      ru.adminAccounts.stateHint.inactive,
      never,
    ]);

    // Ссылок в карточках нет: всё — кнопки действий на этой странице.
    for (const c of cards()) expect(within(c).queryAllByRole("link")).toEqual([]);
  });

  it("последний вход через useFormat, «Не входил» без даты", async () => {
    stubAdmin();
    renderRoute("/admin/accounts", { locale: "kk" });

    // Казахский — dd.MM.yyyy, HH:mm в часовом поясе Алматы.
    const at = (m: Messages, date: string) => fill(m.adminAccounts.lastSignInAt, { date });
    expect(await screen.findByText(at(kk, "12.11.2026, 13:30"))).toBeTruthy();
    expect(row("admin@imbc.local").getByText(at(kk, "12.11.2026, 13:30"))).toBeTruthy();
    expect(row("maker@maker.local").getByText(at(kk, "10.11.2026, 09:00"))).toBeTruthy();
    for (const email of ["expert@imbc.local", "operator@operator.local", "observer@observer.local"])
      expect(row(email).getByText(at(kk, kk.adminAccounts.never))).toBeTruthy();
    cleanup();

    stubAdmin();
    renderRoute("/admin/accounts", { locale: "ru" });
    expect(await screen.findByText(at(ru, "12.11.2026, 13:30"))).toBeTruthy();
    expect(screen.getAllByText(at(ru, ru.adminAccounts.never))).toHaveLength(3);
  });

  it("организация без аккаунтов — «Аккаунтов пока нет» и что делать дальше", async () => {
    stubAdmin();
    renderRoute("/admin/accounts", { locale: "en" });

    await screen.findByText("ТОО «Демо Агро Өнім»");
    const view = within(cardOf("ТОО «Демо Агро Өнім»"));
    expect(view.getByText(en.adminAccounts.noAccounts)).toBeTruthy();
    // Аккаунт производителя создаёт регистрация: пригласить в эту организацию нельзя.
    expect(view.getByText(en.adminAccounts.noAccountsManufacturer)).toBeTruthy();
    expect(view.queryByRole("button")).toBeNull();
    expect(view.queryByRole("list")).toBeNull();
    expect(screen.getAllByText(en.adminAccounts.noAccounts)).toHaveLength(1);
  });

  it("пусто и сбой различаются", async () => {
    stubAdmin({}, { organizations: [], imbcMailbox: null });
    renderRoute("/admin/accounts", { locale: "kk" });

    expect(await screen.findByText(kk.adminAccounts.empty)).toBeTruthy();
    expect(screen.queryByText(kk.adminAccounts.loadError)).toBeNull();
    cleanup();

    let fail = true;
    const unavailable = problem(503, "unavailable") as (url: URL) => Response;
    const api = stubAdmin({ [`GET ${ACCOUNTS_PATH}`]: (url) => (fail ? unavailable(url) : Response.json(ACCOUNTS)) });
    const { user } = renderRoute("/admin/accounts", { locale: "kk" });

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(kk.adminAccounts.loadError)).toBeTruthy();
    expect(screen.queryByText(kk.adminAccounts.empty)).toBeNull();
    // Без списка действовать не над чем: кнопок создания и приглашения нет.
    expect(screen.queryByRole("button", { name: kk.adminAccounts.inviteUser })).toBeNull();
    fail = false;
    await user.click(within(alert).getByRole("button", { name: kk.common.retry }));
    expect(await screen.findByText("Оператор (демо)")).toBeTruthy();
    expect(screen.queryByText(kk.adminAccounts.loadError)).toBeNull();
    expect(listCalls(api)).toHaveLength(2);
  });
});

describe("кабинет администратора: действия (ADM-01, ADM-02, ADM-03, ADM-05, GEN-05, AUTH-06)", () => {
  it("ящик IMBC: показан, меняется, пустое значение отправляет null, неверный адрес — ошибка поля", async () => {
    const path = "/api/v1/admin/imbc-mailbox";
    let api = stubAdmin({ [`PUT ${path}`]: { body: { imbcMailbox: "imbc-mail@demo.local" } } });
    let { user } = renderRoute("/admin/accounts", { locale: "en" });
    const t = en.adminAccounts;

    await screen.findByText("Оператор (демо)");
    const card = within(cardOf(t.imbcMailbox));
    expect(card.getByText(t.imbcMailboxNotSet)).toBeTruthy();
    expect(card.getByText(t.imbcMailboxHint)).toBeTruthy();

    await user.click(card.getByRole("button", { name: t.change }));
    let dialog = within(await screen.findByRole("dialog", { name: t.imbcMailbox }));
    const field = dialog.getByLabelText(t.email);
    // Неверный адрес — ошибка у поля, запроса нет.
    await user.type(field, "not-an-email");
    await user.click(dialog.getByRole("button", { name: t.save }));
    const error = await dialog.findByText(t.fieldErrors.email);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toContain(error.id);
    expect(sent(api, "PUT", path)).toEqual([]);

    await user.clear(field);
    await user.type(field, " IMBC-Mail@demo.local ");
    expect(dialog.queryByText(t.fieldErrors.email)).toBeNull();
    await user.click(dialog.getByRole("button", { name: t.save }));
    expect(await screen.findByText(t.mailboxSaved)).toBeTruthy();
    // Адрес в нижнем регистре, как его хранит сервер (imbcMailboxSchema).
    expect(sent(api, "PUT", path)).toEqual([{ email: "imbc-mail@demo.local" }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(listCalls(api)).toHaveLength(2));
    cleanup();

    // Заданный адрес показан; пустое поле снимает его — null.
    api = stubAdmin(
      { [`PUT ${path}`]: { body: { imbcMailbox: null } } },
      { ...ACCOUNTS, imbcMailbox: "imbc-mail@demo.local" },
    );
    ({ user } = renderRoute("/admin/accounts", { locale: "en" }));
    expect(await screen.findByText("imbc-mail@demo.local")).toBeTruthy();
    expect(within(cardOf(t.imbcMailbox)).getByText("imbc-mail@demo.local")).toBeTruthy();
    await user.click(within(cardOf(t.imbcMailbox)).getByRole("button", { name: t.change }));
    dialog = within(await screen.findByRole("dialog", { name: t.imbcMailbox }));
    expect((dialog.getByLabelText(t.email) as HTMLInputElement).value).toBe("imbc-mail@demo.local");
    expect(dialog.getByText(t.imbcMailboxClearHint)).toBeTruthy();
    await user.clear(dialog.getByLabelText(t.email));
    await user.click(dialog.getByRole("button", { name: t.save }));
    expect(await screen.findByText(t.mailboxCleared)).toBeTruthy();
    expect(sent(api, "PUT", path)).toEqual([{ email: null }]);
  });

  it("создание организации: тип оператор/наблюдатель, галочка major только у оператора; тело запроса; 409 organization_exists — сообщение в диалоге; после успеха список перечитан", async () => {
    const path = "/api/v1/admin/organizations";
    let exists = true;
    const api = stubAdmin({
      [`POST ${path}`]: () =>
        exists
          ? Response.json({ code: "organization_exists", title: "exists", status: 409 }, { status: 409 })
          : Response.json(
              {
                organization: {
                  id: "00000000-0000-4000-8000-000000000050",
                  name: "NCOC",
                  type: "operator",
                  isMajorOperator: true,
                },
              },
              { status: 201 },
            ),
    });
    const { user } = renderRoute("/admin/accounts", { locale: "ru" });
    const t = ru.adminAccounts;

    await user.click(await screen.findByRole("button", { name: t.createOrganization }));
    const dialog = within(await screen.findByRole("dialog", { name: t.createOrganization }));
    // Типы — только оператор и наблюдатель (ADM-03); по умолчанию оператор, галочка major видна.
    expect(await options(user, t.organizationType)).toEqual([t.typeValue.operator, t.typeValue.observer]);
    expect(dialog.getByRole("checkbox", { name: t.majorOperator })).toBeTruthy();
    await choose(user, t.organizationType, t.typeValue.observer);
    expect(dialog.queryByRole("checkbox", { name: t.majorOperator })).toBeNull();
    await choose(user, t.organizationType, t.typeValue.operator);
    await user.click(dialog.getByRole("checkbox", { name: t.majorOperator }));

    // Короткое название — ошибка поля без запроса.
    await user.type(dialog.getByLabelText(t.organizationName), "N");
    await user.click(dialog.getByRole("button", { name: t.create }));
    expect(await dialog.findByText(t.fieldErrors.organizationName)).toBeTruthy();
    expect(sent(api, "POST", path)).toEqual([]);

    await user.type(dialog.getByLabelText(t.organizationName), "COC");
    await user.click(dialog.getByRole("button", { name: t.create }));
    // Занятое название — сообщение в диалоге у поля, диалог открыт.
    expect(await dialog.findByText(t.errors.organization_exists)).toBeTruthy();
    expect(dialog.getByLabelText(t.organizationName).getAttribute("aria-invalid")).toBe("true");
    expect(sent(api, "POST", path)).toEqual([{ name: "NCOC", type: "operator", isMajorOperator: true }]);
    // 409 тоже перечитывает список: он мог устареть.
    await waitFor(() => expect(listCalls(api)).toHaveLength(2));

    exists = false;
    await user.click(dialog.getByRole("button", { name: t.create }));
    expect(await screen.findByText(fill(t.organizationCreated, { name: "NCOC" }))).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(listCalls(api)).toHaveLength(3));

    // Наблюдатель уходит без отметки, даже если галочку ставили у оператора.
    await user.click(screen.getByRole("button", { name: t.createOrganization }));
    const again = within(await screen.findByRole("dialog", { name: t.createOrganization }));
    await user.click(again.getByRole("checkbox", { name: t.majorOperator }));
    await choose(user, t.organizationType, t.typeValue.observer);
    await user.type(again.getByLabelText(t.organizationName), "Наблюдатель (приёмка)");
    await user.click(again.getByRole("button", { name: t.create }));
    await waitFor(() => expect(sent(api, "POST", path)).toHaveLength(3));
    expect(sent(api, "POST", path)[2]).toEqual({
      name: "Наблюдатель (приёмка)",
      type: "observer",
      isMajorOperator: false,
    });
  });

  it("приглашение: в списке организаций нет производителей, роли по типу (IMBC — три), тело запроса; 409 email_exists — сообщение", async () => {
    const path = "/api/v1/admin/accounts";
    let taken = true;
    const api = stubAdmin({
      [`POST ${path}`]: (_url, init) => {
        if (taken) return Response.json({ code: "email_exists", title: "exists", status: 409 }, { status: 409 });
        const body = JSON.parse(String(init?.body));
        return Response.json(
          { account: { id: "00000000-0000-4000-8000-000000000060", ...body, state: "invited", lastSignInAt: null } },
          { status: 201 },
        );
      },
    });
    const { user } = renderRoute("/admin/accounts", { locale: "en" });
    const t = en.adminAccounts;

    await user.click(await screen.findByRole("button", { name: t.inviteUser }));
    const dialog = within(await screen.findByRole("dialog", { name: t.inviteUser }));
    expect(dialog.getByText(t.inviteHint)).toBeTruthy();
    // Организации IMBC, операторов и наблюдателей; производителей нет (GEN-01).
    expect(await options(user, t.organization)).toEqual(["IMBC", "Оператор (демо)", "Наблюдатель (демо)"]);
    // Без организации роль не выбрать.
    expect(dialog.getByRole("combobox", { name: t.role }).hasAttribute("data-disabled")).toBe(true);

    await choose(user, t.organization, "IMBC");
    expect(await options(user, t.role)).toEqual([en.roles.expert, en.roles.administrator, en.roles.director]);
    await choose(user, t.organization, "Оператор (демо)");
    // У оператора роль одна и уже выбрана.
    expect(dialog.getByRole("combobox", { name: t.role }).textContent).toContain(en.roles.operator);
    expect(await options(user, t.role)).toEqual([en.roles.operator]);

    // Пустые поля — ошибки у полей, запроса нет.
    await user.click(dialog.getByRole("button", { name: t.invite }));
    expect(await dialog.findByText(t.fieldErrors.email)).toBeTruthy();
    expect(dialog.getByText(t.fieldErrors.fullName)).toBeTruthy();
    expect(sent(api, "POST", path)).toEqual([]);

    await user.type(dialog.getByLabelText(t.email), "Stage1-Operator@demo.local");
    await user.type(dialog.getByLabelText(t.name), "Новый оператор");
    await user.click(dialog.getByRole("button", { name: t.invite }));
    const exists = await dialog.findByText(t.errors.email_exists);
    expect(dialog.getByLabelText(t.email).getAttribute("aria-describedby")).toContain(exists.id);
    expect(sent(api, "POST", path)).toEqual([
      {
        email: "stage1-operator@demo.local",
        fullName: "Новый оператор",
        organizationId: OPERATOR_ID,
        role: "operator",
      },
    ]);

    // Новый адрес снимает ошибку; приглашение в IMBC с выбранной ролью.
    taken = false;
    await user.clear(dialog.getByLabelText(t.email));
    await user.type(dialog.getByLabelText(t.email), "stage1-sme@demo.local");
    expect(dialog.queryByText(t.errors.email_exists)).toBeNull();
    await choose(user, t.organization, "IMBC");
    await user.click(dialog.getByRole("button", { name: t.invite }));
    expect(await dialog.findByText(t.fieldErrors.role)).toBeTruthy();
    await choose(user, t.role, en.roles.expert);
    await user.click(dialog.getByRole("button", { name: t.invite }));
    expect(await screen.findByText(fill(t.invited, { email: "stage1-sme@demo.local" }))).toBeTruthy();
    expect(sent(api, "POST", path)[1]).toEqual({
      email: "stage1-sme@demo.local",
      fullName: "Новый оператор",
      organizationId: IMBC_ID,
      role: "expert",
    });
    // Перечитан после 409 и после приглашения.
    await waitFor(() => expect(listCalls(api)).toHaveLength(3));
  });

  it("действия по состоянию: invited — повтор приглашения; active — блокировка через подтверждение; blocked — разблокировка; IMBC — смена роли; производитель — смена почты; своя строка — без блокировки и смены роли", async () => {
    const accountPath = (id: string, action: string) => `${ACCOUNTS_PATH}/${id}/${action}`;
    const api = stubAdmin({
      [`POST ${accountPath(EXPERT_ID, "invitation")}`]: { status: 202, body: { status: "password_email_queued" } },
      [`POST ${accountPath(MAKER_ID, "block")}`]: { body: { account: { ...accountOf(MAKER_ID), state: "blocked" } } },
      [`POST ${accountPath(OPERATOR_ACCOUNT_ID, "unblock")}`]: {
        body: { account: { ...accountOf(OPERATOR_ACCOUNT_ID), state: "inactive" } },
      },
    });
    const { user } = renderRoute("/admin/accounts", { locale: "en" });
    const t = en.adminAccounts;
    await screen.findByText("Оператор (демо)");

    // Своя строка — ни блокировки, ни смены роли; других действий у активного администратора нет.
    expect(screen.queryByRole("button", { name: fill(t.actions, { email: "admin@imbc.local" }) })).toBeNull();
    expect(await openMenu(user, en, "expert@imbc.local")).toEqual([t.resendInvitation, t.changeRole, t.block]);
    await closeMenu(user);
    expect(await openMenu(user, en, "operator@operator.local")).toEqual([t.unblock]);
    await closeMenu(user);
    // Неактивный: повтора приглашения нет (вернётся через «Забыли пароль»), блокировать можно.
    expect(await openMenu(user, en, "observer@observer.local")).toEqual([t.block]);
    await closeMenu(user);
    expect(await openMenu(user, en, "maker@maker.local")).toEqual([t.changeEmail, t.block]);
    await closeMenu(user);

    // Повтор приглашения — сразу, без подтверждения.
    await openMenu(user, en, "expert@imbc.local");
    await user.click(screen.getByRole("menuitem", { name: t.resendInvitation }));
    expect(await screen.findByText(t.invitationResent)).toBeTruthy();
    expect(sent(api, "POST", accountPath(EXPERT_ID, "invitation"))).toEqual([undefined]);
    await waitFor(() => expect(listCalls(api)).toHaveLength(2));

    // Блокировка — только после подтверждения; «Отмена» ничего не шлёт.
    await openMenu(user, en, "maker@maker.local");
    await user.click(screen.getByRole("menuitem", { name: t.block }));
    let confirm = within(
      await screen.findByRole("alertdialog", { name: fill(t.blockConfirmTitle, { email: "maker@maker.local" }) }),
    );
    expect(confirm.getByText(t.blockConfirmText)).toBeTruthy();
    await user.click(confirm.getByRole("button", { name: t.cancel }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(sent(api, "POST", accountPath(MAKER_ID, "block"))).toEqual([]);

    await openMenu(user, en, "maker@maker.local");
    await user.click(screen.getByRole("menuitem", { name: t.block }));
    confirm = within(await screen.findByRole("alertdialog"));
    // Двойной щелчок — один запрос.
    await user.dblClick(confirm.getByRole("button", { name: t.block }));
    expect(await screen.findByText(fill(t.blocked, { email: "maker@maker.local" }))).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(sent(api, "POST", accountPath(MAKER_ID, "block"))).toHaveLength(1);

    // Разблокировка — сразу; аккаунт, неактивный до блокировки, остаётся inactive — сказано, как вернуться.
    await openMenu(user, en, "operator@operator.local");
    await user.click(screen.getByRole("menuitem", { name: t.unblock }));
    expect(await screen.findByText(fill(t.unblockedInactive, { email: "operator@operator.local" }))).toBeTruthy();
    expect(sent(api, "POST", accountPath(OPERATOR_ACCOUNT_ID, "unblock"))).toEqual([undefined]);
    await waitFor(() => expect(listCalls(api)).toHaveLength(4));
  });

  it("смена роли и почты: последствие сказано до сохранения, тело запроса", async () => {
    const rolePath = `${ACCOUNTS_PATH}/${EXPERT_ID}/role`;
    const emailPath = `${ACCOUNTS_PATH}/${MAKER_ID}/email`;
    const api = stubAdmin({
      [`PUT ${rolePath}`]: { body: { account: { ...accountOf(EXPERT_ID), role: "director" } } },
      [`PUT ${emailPath}`]: { body: { account: { ...accountOf(MAKER_ID), email: "maker2@maker.local" } } },
    });
    const { user } = renderRoute("/admin/accounts", { locale: "ru" });
    const t = ru.adminAccounts;
    await screen.findByText("Оператор (демо)");

    await openMenu(user, ru, "expert@imbc.local");
    await user.click(screen.getByRole("menuitem", { name: t.changeRole }));
    let dialog = within(
      await screen.findByRole("dialog", { name: fill(t.changeRoleTitle, { email: "expert@imbc.local" }) }),
    );
    expect(dialog.getByText(t.changeRoleHint)).toBeTruthy();
    // Роли сотрудника IMBC, текущая выбрана.
    expect(dialog.getByRole("combobox", { name: t.role }).textContent).toContain(ru.roles.expert);
    expect(await options(user, t.role)).toEqual([ru.roles.expert, ru.roles.administrator, ru.roles.director]);
    await choose(user, t.role, ru.roles.director);
    await user.click(dialog.getByRole("button", { name: t.save }));
    expect(await screen.findByText(fill(t.roleChanged, { email: "expert@imbc.local" }))).toBeTruthy();
    expect(sent(api, "PUT", rolePath)).toEqual([{ role: "director" }]);

    await openMenu(user, ru, "maker@maker.local");
    await user.click(screen.getByRole("menuitem", { name: t.changeEmail }));
    dialog = within(
      await screen.findByRole("dialog", { name: fill(t.changeEmailTitle, { email: "maker@maker.local" }) }),
    );
    expect(dialog.getByText(t.changeEmailHint)).toBeTruthy();
    // Письмо установки пароля — только у приглашённого.
    expect(dialog.queryByText(t.changeEmailInvitedHint)).toBeNull();
    await user.type(dialog.getByLabelText(t.newEmail), "maker2@maker");
    await user.click(dialog.getByRole("button", { name: t.save }));
    expect(await dialog.findByText(t.fieldErrors.email)).toBeTruthy();
    await user.type(dialog.getByLabelText(t.newEmail), ".local");
    await user.click(dialog.getByRole("button", { name: t.save }));
    expect(await screen.findByText(fill(t.emailChanged, { email: "maker2@maker.local" }))).toBeTruthy();
    expect(sent(api, "PUT", emailPath)).toEqual([{ email: "maker2@maker.local" }]);
    await waitFor(() => expect(listCalls(api)).toHaveLength(3));
  });

  it("отметка major у оператора переключается PUT-запросом", async () => {
    const path = `/api/v1/admin/organizations/${OPERATOR_ID}/major-operator`;
    const operator = ACCOUNTS.organizations[1]!;
    let major = true;
    const api = stubAdmin({
      [`GET ${ACCOUNTS_PATH}`]: () =>
        Response.json({
          ...ACCOUNTS,
          organizations: ACCOUNTS.organizations.map((o) =>
            o.id === OPERATOR_ID ? { ...o, isMajorOperator: major } : o,
          ),
        }),
      [`PUT ${path}`]: (_url, init) => {
        major = JSON.parse(String(init?.body)).isMajorOperator;
        const organization = { id: operator.id, name: operator.name, type: operator.type };
        return Response.json({ organization: { ...organization, isMajorOperator: major } });
      },
    });
    const { user } = renderRoute("/admin/accounts", { locale: "kk" });
    const t = kk.adminAccounts;
    await screen.findByText("Оператор (демо)");

    // Кнопка только у оператора: у IMBC, наблюдателя и производителя отметки нет (GEN-05).
    for (const name of ["IMBC", "Наблюдатель (демо)", "ТОО «Станок»"]) {
      expect(within(cardOf(name)).queryByRole("button", { name: t.markMajor })).toBeNull();
      expect(within(cardOf(name)).queryByRole("button", { name: t.unmarkMajor })).toBeNull();
    }
    await user.click(within(cardOf("Оператор (демо)")).getByRole("button", { name: t.unmarkMajor }));
    expect(await screen.findByText(fill(t.majorUnmarked, { name: "Оператор (демо)" }))).toBeTruthy();
    expect(await within(cardOf("Оператор (демо)")).findByRole("button", { name: t.markMajor })).toBeTruthy();
    expect(within(cardOf("Оператор (демо)")).queryByText(t.majorOperator)).toBeNull();

    await user.click(within(cardOf("Оператор (демо)")).getByRole("button", { name: t.markMajor }));
    expect(await screen.findByText(fill(t.majorMarked, { name: "Оператор (демо)" }))).toBeTruthy();
    expect(await within(cardOf("Оператор (демо)")).findByText(t.majorOperator)).toBeTruthy();
    expect(sent(api, "PUT", path)).toEqual([{ isMajorOperator: false }, { isMajorOperator: true }]);
  });

  it("ошибки self_action, identity_not_bound, not_invited переведены", async () => {
    const api = stubAdmin({
      [`POST ${ACCOUNTS_PATH}/${EXPERT_ID}/invitation`]: problem(409, "not_invited"),
      [`POST ${ACCOUNTS_PATH}/${MAKER_ID}/block`]: problem(409, "self_action"),
      [`PUT ${ACCOUNTS_PATH}/${MAKER_ID}/email`]: problem(409, "identity_not_bound"),
      [`POST ${ACCOUNTS_PATH}/${OPERATOR_ACCOUNT_ID}/unblock`]: problem(503, "busy"),
      [`PUT ${ACCOUNTS_PATH}/${EXPERT_ID}/role`]: problem(502, "http_502"),
    });
    const { user } = renderRoute("/admin/accounts", { locale: "ru" });
    const t = ru.adminAccounts;
    await screen.findByText("Оператор (демо)");

    await openMenu(user, ru, "expert@imbc.local");
    await user.click(screen.getByRole("menuitem", { name: t.resendInvitation }));
    expect(await screen.findByText(t.errors.not_invited)).toBeTruthy();

    await openMenu(user, ru, "maker@maker.local");
    await user.click(screen.getByRole("menuitem", { name: t.block }));
    const confirm = within(await screen.findByRole("alertdialog"));
    await user.click(confirm.getByRole("button", { name: t.block }));
    // Ошибка — в диалоге, он остаётся открытым.
    expect(await confirm.findByText(t.errors.self_action)).toBeTruthy();
    await user.click(confirm.getByRole("button", { name: t.cancel }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    await openMenu(user, ru, "maker@maker.local");
    await user.click(screen.getByRole("menuitem", { name: t.changeEmail }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText(t.newEmail), "maker2@maker.local");
    await user.click(dialog.getByRole("button", { name: t.save }));
    expect(await dialog.findByText(t.errors.identity_not_bound)).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Запись занята — повтор безопасен; неизвестный код — общее сообщение.
    await openMenu(user, ru, "operator@operator.local");
    await user.click(screen.getByRole("menuitem", { name: t.unblock }));
    expect(await screen.findByText(t.errors.busy)).toBeTruthy();

    await openMenu(user, ru, "expert@imbc.local");
    await user.click(screen.getByRole("menuitem", { name: t.changeRole }));
    const role = within(await screen.findByRole("dialog"));
    await choose(user, t.role, ru.roles.director);
    await user.click(role.getByRole("button", { name: t.save }));
    expect(await role.findByText(t.errors.requestError)).toBeTruthy();
    // Список перечитан после трёх ответов 409 (он мог устареть), но не после 503 и 502.
    await waitFor(() => expect(listCalls(api)).toHaveLength(4));
  });

  it("сеанс закончился посреди действия: /me перечитан, итог можно скрыть", async () => {
    const api = stubAdmin({ [`POST ${ACCOUNTS_PATH}/${EXPERT_ID}/invitation`]: problem(401, "unauthenticated") });
    const { user } = renderRoute("/admin/accounts", { locale: "en" });
    const t = en.adminAccounts;
    await screen.findByText("Оператор (демо)");
    const meCalls = () => api.mock.calls.filter(([url]) => String(url) === "/api/auth/me").length;
    const before = meCalls();

    await openMenu(user, en, "expert@imbc.local");
    await user.click(screen.getByRole("menuitem", { name: t.resendInvitation }));
    expect(await screen.findByText(t.errors.session)).toBeTruthy();
    // AppShell по перечитанному /me уводит на вход (здесь /me ещё отвечает — страница остаётся).
    await waitFor(() => expect(meCalls()).toBeGreaterThan(before));

    await user.click(screen.getByRole("button", { name: t.dismiss }));
    expect(screen.queryByText(t.errors.session)).toBeNull();
  });

  it("каждый код ошибки маршрутов администратора переведён на три языка", () => {
    for (const code of ADMIN_PROBLEM_CODES) {
      const key = ADMIN_PROBLEM_MESSAGES[code];
      for (const [locale, messages] of Object.entries({ en, ru, kk }))
        expect(messages.adminAccounts.errors[key], `${locale}: ${code}`).toMatch(/\S/);
    }
  });

  it("на странице нет БИН и полей профиля (ADM-06)", async () => {
    // Ответ с лишними полями (новое поле API или ошибка сервера) читается, но лишнее не показывается.
    const leaky = {
      ...ACCOUNTS,
      organizations: ACCOUNTS.organizations.map((o) => ({
        ...o,
        bin: "123456789012",
        profileStatus: "verified",
        completeness: 87,
        accounts: o.accounts.map((a) => ({ ...a, idpSubject: "kc-subject-1" })),
      })),
    };
    stubAdmin({}, leaky);
    const { user } = renderRoute("/admin/accounts", { locale: "ru" });
    await screen.findByText("ТОО «Станок»");

    const text = () => document.body.textContent ?? "";
    for (const forbidden of [
      "123456789012",
      "kc-subject-1",
      "87",
      ru.register.bin,
      ...Object.values(ru.profile.statusValue),
      ...Object.values(ru.catalog.tierValue),
    ])
      expect(text(), forbidden).not.toContain(forbidden);
    // И в диалоге приглашения — только почта, имя, организация и роль.
    await user.click(screen.getByRole("button", { name: ru.adminAccounts.inviteUser }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(ru.register.bin)).toBeNull();
    expect(
      within(dialog)
        .getAllByRole("textbox")
        .map((field) => field.id),
    ).toHaveLength(2);
    expect(within(dialog).getAllByRole("combobox")).toHaveLength(2);
    expect(within(dialog).getByLabelText(ru.adminAccounts.email)).toBeTruthy();
    expect(within(dialog).getByLabelText(ru.adminAccounts.name)).toBeTruthy();
  });

  it("меню и диалоги доступны с клавиатуры (Enter, Escape, возврат фокуса)", async () => {
    const emailPath = `${ACCOUNTS_PATH}/${MAKER_ID}/email`;
    const api = stubAdmin({
      [`PUT ${emailPath}`]: { body: { account: { ...accountOf(MAKER_ID), email: "maker2@maker.local" } } },
    });
    const { user } = renderRoute("/admin/accounts", { locale: "kk" });
    const t = kk.adminAccounts;
    await screen.findByText("Оператор (демо)");

    // Диалог с кнопки: Enter открывает, фокус внутри, Escape закрывает и возвращает фокус.
    const invite = screen.getByRole("button", { name: t.inviteUser });
    invite.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: t.inviteUser });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(invite));

    // Меню строки: Enter открывает, стрелки выбирают, Escape закрывает — фокус на кнопке меню.
    const menu = menuButton(kk, "maker@maker.local");
    menu.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(menu));

    // Подтверждение блокировки с клавиатуры: Escape закрывает без запроса, фокус — на кнопке меню.
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await waitFor(() => expect(document.activeElement?.textContent).toBe(t.changeEmail));
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.activeElement?.textContent).toBe(t.block));
    await user.keyboard("{Enter}");
    const confirm = await screen.findByRole("alertdialog");
    await waitFor(() => expect(confirm.contains(document.activeElement)).toBe(true));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(menu));
    expect(api.mock.calls.some(([url]) => String(url).endsWith("/block"))).toBe(false);

    // Смена почты: Enter в поле отправляет форму; после успеха фокус снова на кнопке меню.
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await waitFor(() => expect(document.activeElement?.textContent).toBe(t.changeEmail));
    await user.keyboard("{Enter}");
    const email = within(await screen.findByRole("dialog"));
    await waitFor(() => expect(document.activeElement).toBe(email.getByLabelText(t.newEmail)));
    await user.keyboard("maker2@maker.local{Enter}");
    expect(await screen.findByText(fill(t.emailChanged, { email: "maker2@maker.local" }))).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(menu));
    expect(sent(api, "PUT", emailPath)).toEqual([{ email: "maker2@maker.local" }]);
  });

  it("тексты на kk и en", async () => {
    for (const [locale, m] of [
      ["kk", kk],
      ["en", en],
    ] as const) {
      stubAdmin();
      const { user } = renderRoute("/admin/accounts", { locale });
      const t = m.adminAccounts;
      await screen.findByText("Оператор (демо)");

      expect(screen.getByRole("button", { name: t.createOrganization }), locale).toBeTruthy();
      expect(screen.getByRole("button", { name: t.inviteUser }), locale).toBeTruthy();
      expect(within(cardOf(t.imbcMailbox)).getByText(t.imbcMailboxNotSet), locale).toBeTruthy();
      expect(within(cardOf("Оператор (демо)")).getByRole("button", { name: t.unmarkMajor }), locale).toBeTruthy();
      expect(await openMenu(user, m, "expert@imbc.local"), locale).toEqual([t.resendInvitation, t.changeRole, t.block]);
      await user.click(screen.getByRole("menuitem", { name: t.block }));
      const confirm = within(await screen.findByRole("alertdialog"));
      expect(confirm.getByText(fill(t.blockConfirmTitle, { email: "expert@imbc.local" })), locale).toBeTruthy();
      expect(confirm.getByText(t.blockConfirmText), locale).toBeTruthy();
      expect(confirm.getByRole("button", { name: t.cancel }), locale).toBeTruthy();
      cleanup();
    }
  });
});
