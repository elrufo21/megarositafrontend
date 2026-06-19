import { buildApiUrl } from "@/config";
import { apiRequest } from "@/shared/helpers/apiRequest";

type OrderNoteViewData = {
  notaResponse: unknown;
  detallesResponse: unknown;
};

let cachedId = 0;
let cachedRequest: Promise<OrderNoteViewData> | null = null;

export const loadOrderNoteView = (noteId: number) => {
  if (cachedId === noteId && cachedRequest) return cachedRequest;

  cachedId = noteId;
  const request = Promise.all([
    apiRequest({
      url: buildApiUrl(`/Nota/${noteId}`),
      method: "GET",
      config: { headers: { Accept: "text/plain" } },
      fallback: null,
      blockUi: false,
    }),
    apiRequest({
      url: buildApiUrl(`/Nota/${noteId}/detalles`),
      method: "GET",
      config: { headers: { Accept: "text/plain" } },
      fallback: [],
      blockUi: false,
    }),
  ]).then(([notaResponse, detallesResponse]) => ({
    notaResponse,
    detallesResponse,
  }));
  cachedRequest = request;

  const expire = () =>
    window.setTimeout(() => {
      if (cachedRequest !== request) return;
      cachedId = 0;
      cachedRequest = null;
    }, 10_000);
  request.then(expire, expire);

  return request;
};
