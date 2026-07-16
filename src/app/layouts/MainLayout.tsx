import { Outlet, Link, useLocation, useNavigate } from "react-router";
import {
  UserCheck,
  DollarSign,
  Menu,
  X,
  ChevronDown,
  CopySlashIcon,
  Loader2,
  LogOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { toast } from "@/shared/ui/toast";
import { buildApiUrl } from "@/config";
import { useAuthStore, type AuthUser } from "@/store/auth/auth.store";
import { apiRequest } from "@/shared/helpers/apiRequest";
import {
  getPendingRequests,
  subscribeToPendingRequests,
} from "@/shared/helpers/apiRequest";

interface CompanyOption {
  id: string;
  name: string;
}

const normalizeText = (value: unknown): string => String(value ?? "").trim();

const normalizeCompanyItems = (payload: unknown): CompanyOption[] => {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown[] } | null)?.data)
      ? ((payload as { data: unknown[] }).data)
      : [];

  return items
    .map((item) => {
      const record = item as Record<string, unknown>;
      const id = normalizeText(record.Id ?? record.id ?? record.CompaniaId);
      const name = normalizeText(
        record.Nombre ?? record.nombre ?? record.CompaniaRazonSocial,
      );
      return id && name ? { id, name } : null;
    })
    .filter((item): item is CompanyOption => item !== null);
};

const toCompanyUserPatch = (
  payload: unknown,
  fallback: CompanyOption,
): Partial<AuthUser> & Pick<AuthUser, "companyId" | "companyName"> => {
  const record =
    ((payload as { data?: unknown } | null)?.data ?? payload) as Record<
      string,
      unknown
    >;
  const numberOrZero = (value: unknown) => {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  };
  const boolValue = (value: unknown) =>
    value === true ||
    value === 1 ||
    ["1", "true", "si", "sí", "s"].includes(normalizeText(value).toLowerCase());

  return {
    companyId: normalizeText(
      record.CompaniaId ?? record.companiaId ?? record.companyId ?? fallback.id,
    ),
    companyName:
      normalizeText(
        record.CompaniaRazonSocial ??
          record.companiaRazonSocial ??
          record.razonSocial,
      ) || fallback.name,
    companyRuc: normalizeText(
      record.CompaniaRUC ?? record.CompaniaRuc ?? record.companiaRuc,
    ),
    companyUbigeoName: normalizeText(
      record.CompaniaNomUBG ??
        record.CompaniaNomUbg ??
        record.companiaNomUbg ??
        record.CompaniaDistrito,
    ),
    companyCommercialName: normalizeText(
      record.CompaniaComercial ?? record.companiaComercial,
    ),
    companySunatAddress: normalizeText(
      record.CompaniaDirecSunat ??
        record.companiaDirecSunat ??
        record.CompaniaDireccion,
    ),
    companyPhone: normalizeText(
      record.CompaniaTelefono ?? record.companiaTelefono,
    ),
    companyLogo: normalizeText(record.LogoCompania ?? record.logoCompania),
    usuarioSol: normalizeText(
      record.UsuarioSol ?? record.usuarioSol ?? record.CompaniaUserSecun,
    ),
    claveSol: normalizeText(
      record.ClaveSol ?? record.claveSol ?? record.ComapaniaPWD,
    ),
    certificadoBase64: normalizeText(
      record.CertificadoBase64 ?? record.certificadoBase64 ?? record.CompaniaPFX,
    ),
    claveCertificado: normalizeText(
      record.ClaveCertificado ??
        record.claveCertificado ??
        record.CompaniaClave,
    ),
    entorno: normalizeText(record.Entorno ?? record.entorno),
    maxDiscount: numberOrZero(record.DescuentoMax ?? record.descuentoMax),
    boletaPorLote: boolValue(record.BoletaPorLote ?? record.boletaPorLote),
  };
};

export default function MainLayout() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuContainerRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState(""); // 🔍 buscador
  const { pathname } = useLocation();
  const pendingRequests = useSyncExternalStore(
    subscribeToPendingRequests,
    getPendingRequests,
    () => 0,
  );
  const blockForRequest =
    pendingRequests > 0 &&
    (pathname.startsWith("/sales/order_notes") ||
      pathname.startsWith("/customers"));
  const isPaymentViewCompanyLocked = /^\/sales\/order_notes\/[^/]+\/view$/i.test(
    pathname,
  );

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const setSessionCompany = useAuthStore((state) => state.setSessionCompany);

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  const userInitial =
    user?.displayName?.charAt(0)?.toUpperCase() ||
    user?.username?.charAt(0)?.toUpperCase() ||
    "?";
  const userSessionLabel = useMemo(() => {
    const record = user as Record<string, unknown> | null | undefined;
    const role = String(record?.role ?? "").trim();
    return role || "Sesión activa";
  }, [user]);
  const headerTitle = useMemo(() => {
    const fromState = String(user?.companyName ?? "").trim();
    if (fromState) return fromState;
    if (typeof window === "undefined") return "Panel de Control";

    try {
      const raw = window.localStorage.getItem("sgo.auth.session");
      if (!raw) return "Panel de Control";

      const parsed = JSON.parse(raw) as
        | { razonSocial?: unknown; user?: { companyName?: unknown } }
        | null;
      const fromStorage = String(
        parsed?.user?.companyName ?? parsed?.razonSocial ?? "",
      ).trim();
      return fromStorage || "Panel de Control";
    } catch {
      return "Panel de Control";
    }
  }, [user?.companyName]);

  useEffect(() => {
    queueMicrotask(() => {
      setOpen(false);
      setMobileOpen(false);
      setUserMenuOpen(false);
    });
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen || typeof document === "undefined") return;
    const originalOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!userMenuOpen || typeof document === "undefined") return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (userMenuContainerRef.current?.contains(target)) return;
      setUserMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [userMenuOpen]);

  const loadCompanies = useCallback(() => {
    if (companies.length > 0 || companiesLoading) return;

    setCompaniesLoading(true);
    void apiRequest<unknown>({
      url: buildApiUrl("/Compania/combo"),
      blockUi: false,
      fallback: [],
    })
      .then((response) => {
        setCompanies(normalizeCompanyItems(response));
      })
      .finally(() => {
        setCompaniesLoading(false);
      });
  }, [companies.length, companiesLoading]);

  const handleSelectCompany = useCallback(async (company: CompanyOption) => {
    setSelectedCompanyId(company.id);

    const response = await apiRequest<unknown>({
      url: buildApiUrl(`/Compania/${company.id}`),
      blockUi: false,
      fallback: null,
    });

    setSessionCompany(toCompanyUserPatch(response, company));
    toast.success("Compañía de sesión actualizada.");
    setUserMenuOpen(false);
    if (!pathname.startsWith("/sales/pos") && !pathname.startsWith("/pos")) {
      window.location.reload();
    }
  }, [pathname, setSessionCompany]);

  const navItems = useMemo(() => {
    const items = [
      {
        label: "Ventas",
        to: "/sales/pos",
        icon: <DollarSign size={18} />,
      },
      {
        label: "Lista de ventas ",
        to: "/sales/order_notes",
        icon: <CopySlashIcon size={18} />,
        state: { resetOrderNotesFilters: true },
      },

      { label: "Cliente", to: "/customers", icon: <UserCheck size={18} /> },
    ];

    return items;
  }, []);

  const filteredItems = navItems.filter((item) =>
    item.label.toUpperCase().includes(search.toUpperCase()),
  );

  // Render de items del menú
  const renderNavItem = (
    item: (typeof navItems)[0],
    alwaysShowLabel = false,
  ) => {
    const active = pathname === item.to || pathname.startsWith(item.to + "/");

    return (
      <Link
        key={item.to}
        to={item.to}
        state={item.state}
        className={`group flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
          !open && !alwaysShowLabel ? "justify-center" : "justify-start"
        } ${
          active
            ? "bg-slate-700 text-white shadow-sm"
            : "text-slate-200 hover:bg-slate-700/70 hover:text-white"
        }`}
        title={!open && !alwaysShowLabel ? item.label : undefined}
        onClick={() => setMobileOpen(false)}
      >
        {item.icon}
        {(open || alwaysShowLabel) && (
          <span className="truncate">{item.label}</span>
        )}
      </Link>
    );
  };

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-slate-100">
      {blockForRequest && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/35 backdrop-blur-[1px]"
          role="status"
          aria-live="polite"
          aria-label="Cargando"
        >
          <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 text-slate-800 shadow-xl">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            <span className="font-medium">Cargando...</span>
          </div>
        </div>
      )}
      <aside
        className={`hidden lg:flex shrink-0 flex-col bg-[#1f2b30] shadow-xl transition-all duration-300 ${
          open
            ? "w-[var(--app-shell-sidebar-open)]"
            : "w-[var(--app-shell-sidebar-collapsed)]"
        }`}
      >
        <div className="relative flex items-center border-b border-slate-700/70 px-3 py-3">
          <h1
            className={`truncate text-base font-semibold text-white transition-opacity duration-300 ${
              open ? "opacity-100" : "opacity-0"
            }`}
          >
            SGO VENTAS
          </h1>

          <button
            onClick={() => setOpen(!open)}
            className={`ml-auto rounded-md p-2 text-white transition-colors hover:bg-slate-700 ${
              !open ? "absolute right-2 top-1/2 -translate-y-1/2" : ""
            }`}
          >
            <Menu size={20} />
          </button>
        </div>

        {open && (
          <div className="mt-3 px-3">
            <input
              type="text"
              placeholder="Buscar módulo..."
              data-no-uppercase="true"
              className="h-10 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/50"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}

        {/* Navegación */}
        <nav className="mt-4 flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3">
          {(search ? filteredItems : navItems).map((item) =>
            renderNavItem(item),
          )}
        </nav>

        <div className="border-t border-slate-700/70 px-3 py-3 text-center text-xs text-slate-400">
          {open && "© 2025 Mi Empresa"}
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#222d32]/55 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-[var(--app-shell-sidebar-open)] flex-col bg-[#1f2b30] text-white shadow-xl transition-transform duration-300 lg:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
          <h1 className="text-base font-semibold text-white">SGO VENTAS</h1>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-2 transition-colors hover:bg-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mt-3 px-3">
          <input
            type="text"
            placeholder="Buscar módulo..."
            data-no-uppercase="true"
            className="h-11 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/50"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <nav className="mt-4 flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-4">
          {(search ? filteredItems : navItems).map((item) =>
            renderNavItem(item, true),
          )}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="h-[var(--app-shell-header-h)] bg-[#96312a] px-2 text-white shadow sm:px-4 lg:px-5 xl:px-6">
          <div className="mx-auto flex h-full w-full max-w-[var(--app-shell-content-max)] min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <button
                className="rounded-md p-2 transition-colors hover:bg-slate-500 lg:hidden"
                onClick={() => setMobileOpen(true)}
              >
                <Menu size={20} />
              </button>
              <h2 className="line-clamp-1 max-w-[60vw] text-base font-semibold sm:max-w-[58vw] sm:text-lg md:max-w-[52vw] lg:max-w-[48vw] lg:text-xl">
                {headerTitle}
              </h2>
            </div>

            <div ref={userMenuContainerRef} className="relative shrink-0">
              <button
                onClick={() => {
                  const nextOpen = !userMenuOpen;
                  setUserMenuOpen(nextOpen);
                  if (nextOpen) {
                    setSelectedCompanyId(String(user?.companyId ?? ""));
                    loadCompanies();
                  }
                }}
                className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-2 py-1.5 shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 sm:gap-3 sm:px-3 sm:py-2"
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-900 sm:h-9 sm:w-9">
                  {userInitial}
                </div>
                <div className="hidden min-w-0 sm:flex flex-col text-left leading-tight text-white">
                  <span className="text-sm font-semibold">
                    {user?.displayName ?? user?.username ?? "Usuario"}
                  </span>
                  <span className="text-[11px] text-slate-200">
                    {userSessionLabel}
                  </span>
                </div>
                <ChevronDown size={16} className="text-white/80" />
              </button>

              {userMenuOpen && (
                <Box
                  className="absolute right-0 z-[220] mt-2"
                  sx={{
                    width: 304,
                    overflow: "hidden",
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.paper",
                    color: "text.primary",
                    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.22)",
                  }}
                >
                  <Box sx={{ px: 2, py: 1.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Cambiar compañía
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Selecciona la compañía activa
                    </Typography>
                  </Box>
                  <Divider />
                  <Box sx={{ maxHeight: 224, overflowY: "auto", py: 0.5 }}>
                    {companiesLoading ? (
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1.25,
                          px: 2,
                          py: 2,
                        }}
                      >
                        <CircularProgress size={18} />
                        <Typography variant="body2" color="text.secondary">
                          Cargando compañías...
                        </Typography>
                      </Box>
                    ) : companies.length === 0 ? (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ px: 2, py: 2 }}
                      >
                        No hay compañías disponibles.
                      </Typography>
                    ) : (
                      companies.map((company) => {
                        const checked = selectedCompanyId === company.id;
                        return (
                          <ListItemButton
                            key={company.id}
                            selected={checked}
                            disabled={isPaymentViewCompanyLocked}
                            onClick={() => {
                              if (!isPaymentViewCompanyLocked) {
                                void handleSelectCompany(company);
                              }
                            }}
                            sx={{
                              mx: 1,
                              borderRadius: 1.5,
                              py: 0.75,
                              "&.Mui-selected": {
                                bgcolor: "rgba(150, 49, 42, 0.10)",
                                color: "#96312a",
                              },
                              "&.Mui-selected:hover": {
                                bgcolor: "rgba(150, 49, 42, 0.16)",
                              },
                            }}
                          >
                            <Checkbox
                              edge="start"
                              size="small"
                              checked={checked}
                              tabIndex={-1}
                              disableRipple
                              disabled={isPaymentViewCompanyLocked}
                              sx={{
                                color: "#96312a",
                                "&.Mui-checked": { color: "#96312a" },
                              }}
                            />
                            <ListItemText
                              primary={company.name}
                              primaryTypographyProps={{
                                noWrap: true,
                                fontSize: 14,
                                fontWeight: checked ? 700 : 500,
                              }}
                            />
                          </ListItemButton>
                        );
                      })
                    )}
                  </Box>
                  <Divider />
                  <Box sx={{ p: 1 }}>
                    <Button
                      fullWidth
                      startIcon={<LogOut size={17} />}
                      sx={{
                        justifyContent: "flex-start",
                        color: "text.secondary",
                        textTransform: "none",
                        fontWeight: 600,
                        borderRadius: 1.5,
                        px: 1.5,
                        "&:hover": {
                          bgcolor: "rgba(150, 49, 42, 0.08)",
                          color: "#96312a",
                        },
                      }}
                    onClick={() => {
                      setUserMenuOpen(false);
                      logout();
                      navigate("/login", { replace: true });
                    }}
                  >
                    Cerrar sesión
                    </Button>
                  </Box>
                </Box>
              )}
            </div>
          </div>
        </header>

        <main className="app-main-scroll flex-1 overflow-y-auto overflow-x-auto bg-slate-100 px-[var(--app-shell-main-px)] py-[var(--app-shell-main-py)] min-h-0 min-w-0">
          <div className="mx-auto w-full min-w-0 max-w-[var(--app-shell-content-max)]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
