import {
  lpsCompanyListSchema, lpsCompanyReadSchema, lpsDashboardSchema, lpsEntryReadSchema, lpsListSchema,
  type LpsCompanyWrite, type LpsEntryWrite,
} from "@imbc/contracts";
import { api } from "@/lib/api";
export const lpsApi = {
  entry: async (id: string, locale: string) => lpsEntryReadSchema.parse(await api(`/v1/lps/entries/${id}?${new URLSearchParams({ locale })}`)),
  entries: async (query: string) => lpsListSchema.parse(await api(`/v1/lps/entries?${query}`)),
  dashboard: async (query: string) => lpsDashboardSchema.parse(await api(`/v1/lps/dashboard?${query}`)),
  companies: async (query: string) => lpsCompanyListSchema.parse(await api(`/v1/lps/companies?${query}`)),
  saveCompany: async (id: string | null, input: LpsCompanyWrite) => lpsCompanyReadSchema.parse(await api(`/v1/lps/companies${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", json: input })),
  saveEntry: async (id: string | null, input: LpsEntryWrite) => lpsEntryReadSchema.parse(await api(`/v1/lps/entries${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", json: input })),
  deleteCompany: (id: string) => api<void>(`/v1/lps/companies/${id}`, { method: "DELETE" }),
  deleteEntry: (id: string) => api<void>(`/v1/lps/entries/${id}`, { method: "DELETE" }),
};
