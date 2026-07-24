import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, Plus, Save, X } from "lucide-react";
import CustomerFormBase from "@/components/CustomerFormBase";
import { useDialogStore } from "@/store/app/dialog.store";
import { useClientsStore } from "@/store/customers/customers.store";
import type { Client } from "@/types/customer";

type CustomerDialogContentProps = {
  onSelectClient: (client: Client) => void;
  onCreateClient: (client: Omit<Client, "id">) => Promise<boolean>;
  onUpdateClient?: (
    client: Client,
    data: Omit<Client, "id">,
  ) => Promise<boolean>;
  initialEditingClient?: Client | null;
};

export const CUSTOMER_DIALOG_FORM_ID = "customer-dialog-form";

const normalizeSearchText = (value: unknown) =>
  String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

const tokenizeSearchText = (value: unknown) =>
  normalizeSearchText(value).split(" ").filter(Boolean);

export default function CustomerDialogContent({
  onSelectClient,
  onCreateClient,
  onUpdateClient,
  initialEditingClient = null,
}: CustomerDialogContentProps) {
  const clients = useClientsStore((state) => state.clients);
  const fetchClients = useClientsStore((state) => state.fetchClients);
  const closeDialog = useDialogStore((state) => state.closeDialog);
  const [activeTab, setActiveTab] = useState<"list" | "form">("form");
  const [query, setQuery] = useState("");
  const [editingClient, setEditingClient] = useState<Client | null>(
    initialEditingClient,
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void fetchClients("");
  }, [fetchClients]);

  useEffect(() => {
    if (activeTab !== "list") return;
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [activeTab]);

  const filteredClients = useMemo(() => {
    const tokens = tokenizeSearchText(query);
    if (!tokens.length) return clients.slice(0, 100);

    return clients
      .filter((client) => {
        const haystack = normalizeSearchText(
          `${client.nombreRazon} ${client.ruc} ${client.dni} ${client.telefonoMovil}`,
        );
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 100);
  }, [clients, query]);

  const openNewForm = () => {
    setEditingClient(null);
    setQuery("");
    setActiveTab("form");
  };

  const submitForm = () => {
    setActiveTab("form");
    window.requestAnimationFrame(() => {
      (
        document.getElementById(CUSTOMER_DIALOG_FORM_ID) as
          | HTMLFormElement
          | null
      )?.requestSubmit();
    });
  };

  return (
    <div className="flex h-[68dvh] max-h-[38rem] flex-col overflow-hidden bg-white">
      <div className="shrink-0 bg-[#B23636] px-2 py-2 text-white sm:px-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid w-full grid-cols-2 rounded-md bg-white/10 p-1 lg:w-[28rem]">
            <button
              type="button"
              className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                activeTab === "list"
                  ? "bg-white text-slate-700 shadow-sm"
                  : "text-white hover:bg-white/10"
              }`}
              onClick={() => setActiveTab("list")}
            >
              Clientes
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                activeTab === "form"
                  ? "bg-red-700 text-white shadow-sm"
                  : "text-white hover:bg-white/10"
              }`}
              onClick={openNewForm}
            >
              Formulario
            </button>
          </div>
          <div className="flex items-center justify-end gap-2 overflow-x-auto pb-1 lg:pb-0">
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-white/10 px-3 text-sm font-semibold hover:bg-white/20"
              onClick={openNewForm}
            >
              <Plus className="h-4 w-4" />
              Nuevo
            </button>
            {activeTab === "form" ? (
              <button
                type="button"
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-red-600 px-3 text-sm font-semibold hover:bg-red-700"
                onClick={submitForm}
              >
                <Save className="h-4 w-4" />
                Guardar
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/20 bg-white/10 hover:bg-white/20"
              onClick={closeDialog}
              title="Cerrar"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-6">
        {activeTab === "list" ? (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nombre, DNI, RUC o teléfono"
              className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#B23636] focus:ring-2 focus:ring-red-100"
            />
            <div className="min-h-0 flex-1 space-y-2 overflow-auto md:hidden">
              {filteredClients.length ? (
                filteredClients.map((client) => (
                  <div
                    key={client.id}
                    className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                    onDoubleClick={() => onSelectClient(client)}
                  >
                    <div className="font-semibold text-slate-800">
                      {client.nombreRazon}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <span>DNI: {client.dni || "-"}</span>
                      <span>RUC: {client.ruc || "-"}</span>
                      <span className="col-span-2">
                        Teléfono: {client.telefonoMovil || "-"}
                      </span>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      {onUpdateClient ? (
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
                          onClick={() => {
                            setEditingClient(client);
                            setActiveTab("form");
                          }}
                          title="Editar"
                          aria-label="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#B23636] text-white hover:bg-[#9f2f2f]"
                        onClick={() => onSelectClient(client)}
                        title="Usar"
                        aria-label="Usar"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
                  No se encontraron clientes.
                </div>
              )}
            </div>
            <div className="hidden min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 md:block">
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-red-50 text-xs uppercase text-[#B23636]">
                  <tr className="text-left">
                    <th className="w-[42%] px-3 py-2 font-semibold">Cliente</th>
                    <th className="w-[13%] px-3 py-2 font-semibold">DNI</th>
                    <th className="w-[16%] px-3 py-2 font-semibold">RUC</th>
                    <th className="w-[15%] px-3 py-2 font-semibold">Teléfono</th>
                    <th className="w-[14%] px-3 py-2 text-right font-semibold">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                  {filteredClients.length ? (
                    filteredClients.map((client) => (
                      <tr
                        key={client.id}
                        className="hover:bg-slate-50"
                        onDoubleClick={() => onSelectClient(client)}
                      >
                        <td className="px-3 py-2 font-medium break-words">
                          {client.nombreRazon}
                        </td>
                        <td className="px-3 py-2">{client.dni}</td>
                        <td className="px-3 py-2">{client.ruc}</td>
                        <td className="px-3 py-2">{client.telefonoMovil}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            {onUpdateClient ? (
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
                                onClick={() => {
                                  setEditingClient(client);
                                  setActiveTab("form");
                                }}
                                title="Editar"
                                aria-label="Editar"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#B23636] text-white hover:bg-[#9f2f2f]"
                              onClick={() => onSelectClient(client)}
                              title="Usar"
                              aria-label="Usar"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-8 text-center text-slate-500"
                      >
                        No se encontraron clientes.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="shrink-0 text-xs text-slate-500">
              {filteredClients.length.toLocaleString("en-US")} de{" "}
              {clients.length.toLocaleString("en-US")} clientes
            </div>
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <CustomerFormBase
              key={editingClient?.id ?? "create"}
              mode={editingClient ? "edit" : "create"}
              initialData={editingClient ?? undefined}
              variant="modal"
              formId={CUSTOMER_DIALOG_FORM_ID}
              onSave={(data) =>
                editingClient && onUpdateClient
                  ? onUpdateClient(editingClient, data)
                  : onCreateClient(data)
              }
              onNew={() => setEditingClient(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
