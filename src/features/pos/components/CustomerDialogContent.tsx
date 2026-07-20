import { useEffect, useMemo, useState } from "react";
import CustomerFormBase from "@/components/CustomerFormBase";
import { useClientsStore } from "@/store/customers/customers.store";
import type { Client } from "@/types/customer";

type CustomerDialogContentProps = {
  onSelectClient: (client: Client) => void;
  onCreateClient: (client: Omit<Client, "id">) => Promise<boolean>;
  onUpdateClient?: (
    client: Client,
    data: Omit<Client, "id">,
  ) => Promise<boolean>;
  initialQuery?: string;
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
  initialQuery = "",
  initialEditingClient = null,
}: CustomerDialogContentProps) {
  const clients = useClientsStore((state) => state.clients);
  const fetchClients = useClientsStore((state) => state.fetchClients);
  const [activeTab, setActiveTab] = useState<"list" | "form">("form");
  const [query, setQuery] = useState(initialQuery);
  const [editingClient, setEditingClient] = useState<Client | null>(
    initialEditingClient,
  );

  useEffect(() => {
    void fetchClients("");
  }, [fetchClients]);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold text-slate-800">Clientes</h2>
        <div className="grid w-full grid-cols-2 rounded-lg border border-slate-200 bg-slate-100 p-1 sm:w-[28rem]">
          <button
            type="button"
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              activeTab === "list"
                ? "bg-[#B23636] text-white shadow-sm"
                : "text-slate-600 hover:bg-red-50 hover:text-[#B23636]"
            }`}
            onClick={() => setActiveTab("list")}
          >
            Clientes
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              activeTab === "form"
                ? "bg-[#B23636] text-white shadow-sm"
                : "text-slate-600 hover:bg-red-50 hover:text-[#B23636]"
            }`}
            onClick={() => {
              setEditingClient(null);
              setActiveTab("form");
            }}
          >
            Formulario
          </button>
        </div>
      </div>

      {activeTab === "list" ? (
        <div className="space-y-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre, DNI, RUC o teléfono"
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-[#B23636] focus:ring-2 focus:ring-red-100"
          />
          <div className="max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-red-50 text-xs uppercase text-[#B23636]">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold">Cliente</th>
                  <th className="px-3 py-2 font-semibold">DNI</th>
                  <th className="px-3 py-2 font-semibold">RUC</th>
                  <th className="px-3 py-2 font-semibold">Teléfono</th>
                  <th className="px-3 py-2 text-right font-semibold">Acción</th>
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
                      <td className="px-3 py-2 font-medium">
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
                              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              onClick={() => {
                                setEditingClient(client);
                                setActiveTab("form");
                              }}
                            >
                              Editar
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="rounded-md bg-[#B23636] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#9f2f2f]"
                            onClick={() => onSelectClient(client)}
                          >
                            Usar
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
          <div className="text-xs text-slate-500">
            {filteredClients.length.toLocaleString("en-US")} de{" "}
            {clients.length.toLocaleString("en-US")} clientes
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
}
