import { API_BASE_URL } from "@/config";
import { apiRequest } from "@/shared/helpers/apiRequest";
import type { ApiClient, Client } from "@/types/customer";
import { create } from "zustand";

interface ClientsState {
  clients: Client[];
  loading: boolean;
  fetchClients: (estado?: "ACTIVO" | "INACTIVO" | "") => Promise<void>;
  addClient: (
    client: Omit<Client, "id">,
  ) => Promise<{ ok: boolean; error?: string }>;
  updateClient: (
    id: number,
    data: Partial<Client>,
  ) => Promise<{ ok: boolean; error?: string }>;
  deleteClient: (
    id: number,
  ) => Promise<{ ok: boolean; error?: string }>;
}

const mapApiToClient = (item: unknown): Client => {
  const payload = (item ?? {}) as Record<string, unknown>;
  return {
    id: Number(payload.clienteId ?? payload.ClienteId ?? payload.id ?? 0),
    nombreRazon: String(payload.clienteRazon ?? payload.ClienteRazon ?? ""),
    ruc: String(payload.clienteRuc ?? payload.ClienteRuc ?? ""),
    dni: String(payload.clienteDni ?? payload.ClienteDni ?? ""),
    direccionFiscal: String(
      payload.clienteDireccion ?? payload.ClienteDireccion ?? "",
    ),
    direccionDespacho: String(
      payload.clienteDespacho ?? payload.ClienteDespacho ?? "",
    ),
    telefonoMovil: String(
      payload.clienteTelefono ?? payload.ClienteTelefono ?? "",
    ),
    email: String(payload.clienteCorreo ?? payload.ClienteCorreo ?? ""),
    registradoPor: String(
      payload.clienteUsuario ?? payload.ClienteUsuario ?? "",
    ),
    estado: String(payload.clienteEstado ?? payload.ClienteEstado ?? "ACTIVO"),
    fecha:
      payload.clienteFecha === null || payload.ClienteFecha === null
        ? null
        : String(payload.clienteFecha ?? payload.ClienteFecha ?? ""),
  };
};

const mapClientToApi = (client: Partial<Client>): ApiClient => ({
  clienteId: client.id ?? 0,
  clienteRazon: String(client.nombreRazon ?? "").toUpperCase(),
  clienteRuc: client.ruc ?? "",
  clienteDni: client.dni ?? "",
  clienteDireccion: String(client.direccionFiscal ?? "").toUpperCase(),
  clienteTelefono: String(client.telefonoMovil ?? "").toUpperCase(),
  clienteCorreo: client.email ?? "",
  clienteEstado: String(client.estado ?? "ACTIVO").toUpperCase(),
  clienteDespacho: String(client.direccionDespacho ?? "").toUpperCase(),
  clienteUsuario: String(client.registradoPor ?? "").toUpperCase(),
  clienteFecha: client.fecha ?? null,
});

const parseClientRegisterResponse = (
  result: unknown,
  fallback: ApiClient,
): ApiClient => {
  if (result && typeof result === "object") {
    const payload = result as Record<string, unknown>;
    const parsedId =
      Number(payload.clienteId ?? payload.ClienteId ?? payload.id) ||
      fallback.clienteId;
    const parsedFechaRaw = payload.clienteFecha ?? payload.ClienteFecha;

    return {
      clienteId: parsedId,
      clienteRazon: String(
        payload.clienteRazon ??
          payload.ClienteRazon ??
          payload.nombreRazon ??
          payload.nombre ??
          fallback.clienteRazon,
      ),
      clienteRuc: String(
        payload.clienteRuc ?? payload.ClienteRuc ?? fallback.clienteRuc,
      ),
      clienteDni: String(
        payload.clienteDni ?? payload.ClienteDni ?? fallback.clienteDni,
      ),
      clienteDireccion: String(
        payload.clienteDireccion ??
          payload.ClienteDireccion ??
          fallback.clienteDireccion,
      ),
      clienteTelefono: String(
        payload.clienteTelefono ??
          payload.ClienteTelefono ??
          fallback.clienteTelefono,
      ),
      clienteCorreo: String(
        payload.clienteCorreo ??
          payload.ClienteCorreo ??
          fallback.clienteCorreo,
      ),
      clienteEstado: String(
        payload.clienteEstado ??
          payload.ClienteEstado ??
          fallback.clienteEstado,
      ),
      clienteDespacho: String(
        payload.clienteDespacho ??
          payload.ClienteDespacho ??
          fallback.clienteDespacho,
      ),
      clienteUsuario: String(
        payload.clienteUsuario ??
          payload.ClienteUsuario ??
          fallback.clienteUsuario,
      ),
      clienteFecha:
        parsedFechaRaw === null || parsedFechaRaw === undefined
          ? fallback.clienteFecha
          : String(parsedFechaRaw),
    };
  }

  if (typeof result === "string") {
    const normalized = result.trim();
    if (!normalized || normalized.toLowerCase().includes("existe")) {
      return fallback;
    }

    const [idRaw = "", razonRaw = ""] = normalized.split("|");
    const parsedId = Number(idRaw.trim());
    return {
      ...fallback,
      clienteId:
        Number.isFinite(parsedId) && parsedId > 0
          ? parsedId
          : fallback.clienteId,
      clienteRazon: razonRaw.trim() || fallback.clienteRazon,
    };
  }

  return fallback;
};

const isAxiosGenericMessage = (message: string): boolean =>
  /^Request failed with status code\s+\d+$/i.test(message.trim());

const resolveClientErrorMessage = (payload: unknown): string => {
  if (!payload) return "";

  if (typeof payload === "string") {
    const raw = payload.trim();
    if (!raw) return "";
    if (raw.startsWith("{") && raw.endsWith("}")) {
      try {
        const parsed = JSON.parse(raw);
        const fromParsed = resolveClientErrorMessage(parsed);
        return fromParsed || raw;
      } catch {
        return raw;
      }
    }
    return raw;
  }

  if (payload && typeof payload === "object") {
    const obj = payload as {
      mensaje?: unknown;
      Mensaje?: unknown;
      message?: unknown;
      Message?: unknown;
      error?: unknown;
      Error?: unknown;
      data?: unknown;
      response?: {
        data?: unknown;
      };
    };

    const fromResponseData = resolveClientErrorMessage(obj.response?.data);
    if (fromResponseData) return fromResponseData;

    const fromData = resolveClientErrorMessage(obj.data);
    if (fromData) return fromData;

    const fromMensaje = String(obj.mensaje ?? obj.Mensaje ?? "").trim();
    if (fromMensaje) return fromMensaje;

    const fromMessage = String(obj.message ?? obj.Message ?? "").trim();
    if (fromMessage && !isAxiosGenericMessage(fromMessage)) return fromMessage;

    const fromError = String(obj.error ?? obj.Error ?? "").trim();
    if (fromError) return fromError;
  }

  return "";
};

const parseExistsMessage = (payload: unknown): string | null => {
  const message = resolveClientErrorMessage(payload);
  if (!message) return null;
  const lower = message.toLowerCase();
  if (lower.includes("existe")) return message;
  return null;
};

const hasHttpErrorStatus = (payload: unknown): boolean => {
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as {
    status?: unknown;
    response?: { status?: unknown };
  };

  const directStatus = Number(obj.status ?? 0);
  if (Number.isFinite(directStatus) && directStatus >= 400) return true;

  const responseStatus = Number(obj.response?.status ?? 0);
  return Number.isFinite(responseStatus) && responseStatus >= 400;
};

const normalizeOkFlag = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return null;
};

const resolveMutationOkFlag = (payload: unknown): boolean | null => {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as {
    ok?: unknown;
    Ok?: unknown;
    data?: {
      ok?: unknown;
      Ok?: unknown;
    };
    response?: {
      data?: {
        ok?: unknown;
        Ok?: unknown;
      };
    };
  };

  const candidates = [
    obj.ok,
    obj.Ok,
    obj.data?.ok,
    obj.data?.Ok,
    obj.response?.data?.ok,
    obj.response?.data?.Ok,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeOkFlag(candidate);
    if (normalized !== null) return normalized;
  }

  return null;
};

const resolveClientMutationError = (payload: unknown): string | null => {
  const existsMessage = parseExistsMessage(payload);
  if (existsMessage) return existsMessage;

  const okFlag = resolveMutationOkFlag(payload);
  const failedByStatus = hasHttpErrorStatus(payload);
  const hasExplicitFailure = okFlag === false || failedByStatus;

  if (!hasExplicitFailure) return null;

  const resolvedMessage = resolveClientErrorMessage(payload);
  if (resolvedMessage) return resolvedMessage;

  return "No se pudo guardar el cliente.";
};

const resolveDeleteClientErrorMessage = (payload: unknown): string => {
  return resolveClientErrorMessage(payload);
};

export const useClientsStore = create<ClientsState>((set) => ({
  clients: [],
  loading: false,

  fetchClients: async (estado = "ACTIVO") => {
    set({ loading: true });
    try {
      const query =
        estado && estado.trim() !== ""
          ? `?estado=${encodeURIComponent(estado)}`
          : "";
      const response = await apiRequest<ApiClient[]>({
        url: `${API_BASE_URL}/Cliente/list${query}`,
        method: "GET",
        fallback: [],
      });
      const data = Array.isArray(response) ? response : [];
      set({ clients: data.map(mapApiToClient), loading: false });
    } catch (error) {
      console.error("Error loading clients", error);
      set({ loading: false });
    }
  },

  addClient: async (client) => {
    try {
      set({ loading: true });
      const payload = mapClientToApi(client);
      const created = await apiRequest<unknown>({
        url: `${API_BASE_URL}/Cliente/register`,
        method: "POST",
        data: payload,
        config: {
          headers: {
            Accept: "*/*",
            "Content-Type": "application/json",
          },
        },
        fallback: payload,
      });

      if (
        typeof created === "string" &&
        created.toLowerCase().includes("existe")
      ) {
        return { ok: false, error: parseExistsMessage(created) ?? undefined };
      }

      const mutationError = resolveClientMutationError(created);
      if (mutationError) {
        return { ok: false, error: mutationError };
      }

      const parsedClient = parseClientRegisterResponse(created, payload);
      set((state) => ({
        clients: [...state.clients, mapApiToClient(parsedClient)],
      }));
      return { ok: true };
    } catch (error) {
      console.error("Error creating client", error);
      return { ok: false, error: "No se pudo crear el cliente." };
    } finally {
      set({ loading: false });
    }
  },

  updateClient: async (id, data) => {
    try {
      set({ loading: true });
      const payload = mapClientToApi({ ...data, id });
      const updated = await apiRequest<unknown>({
        url: `${API_BASE_URL}/Cliente/register`,
        method: "POST",
        data: payload,
        config: {
          headers: {
            Accept: "*/*",
            "Content-Type": "application/json",
          },
        },
        fallback: payload,
      });

      if (
        typeof updated === "string" &&
        updated.toLowerCase().includes("existe")
      ) {
        return { ok: false, error: parseExistsMessage(updated) ?? undefined };
      }

      const mutationError = resolveClientMutationError(updated);
      if (mutationError) {
        return { ok: false, error: mutationError };
      }

      const parsedClient = parseClientRegisterResponse(updated, payload);
      set((state) => ({
        clients: state.clients.map((c) =>
          c.id === id ? mapApiToClient(parsedClient) : c,
        ),
      }));
      return { ok: true };
    } catch (error) {
      console.error("Error updating client", error);
      return { ok: false, error: "No se pudo actualizar el cliente." };
    } finally {
      set({ loading: false });
    }
  },

  deleteClient: async (id) => {
    const result = await apiRequest({
      url: `${API_BASE_URL}/Cliente/${id}`,
      method: "DELETE",
      config: { headers: { Accept: "*/*" } },
      fallback: false,
    });

    if (result === false) {
      return { ok: false, error: "No se pudo eliminar el cliente." };
    }

    if (result instanceof Error) {
      const messageFromPayload = resolveDeleteClientErrorMessage(result);
      return {
        ok: false,
        error:
          messageFromPayload ||
          result.message ||
          "No se pudo eliminar el cliente.",
      };
    }

    if (result && typeof result === "object") {
      const payload = result as {
        ok?: unknown;
        Ok?: unknown;
        mensaje?: unknown;
        Mensaje?: unknown;
        message?: unknown;
        Message?: unknown;
        data?: {
          ok?: unknown;
          Ok?: unknown;
          mensaje?: unknown;
          Mensaje?: unknown;
          message?: unknown;
          Message?: unknown;
        };
        response?: {
          status?: unknown;
          data?: {
            ok?: unknown;
            Ok?: unknown;
            mensaje?: unknown;
            Mensaje?: unknown;
            message?: unknown;
            Message?: unknown;
          };
        };
      };
      const payloadData = payload.data;
      const responseData = payload.response?.data;
      const responseStatus = Number(payload.response?.status ?? 0);
      const hasHttpErrorStatus =
        Number.isFinite(responseStatus) && responseStatus >= 400;
      const resolvedOk =
        payload.ok ??
        payload.Ok ??
        payloadData?.ok ??
        payloadData?.Ok ??
        responseData?.ok;
      const resolvedMessage =
        resolveDeleteClientErrorMessage(payload);

      if (resolvedOk === false || hasHttpErrorStatus) {
        return {
          ok: false,
          error: resolvedMessage || "No se pudo eliminar el cliente.",
        };
      }
    }

    set((state) => ({
      clients: state.clients.filter((c) => c.id !== id),
    }));

    return { ok: true };
  },
}));
