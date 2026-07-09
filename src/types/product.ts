export interface ProductUnitOption {
  unidad?: string;
  unidadMedida: string;
  cantidad: number;
  preCosto: number;
  preVenta: number;
  preVentaB: number | string;
  factor?: number;
  valorUM?: number;
  unidadImagen?: string;
}

export interface Product {
  id: number;
  idSubLinea?: number | null;
  categoria?: string;
  nombreLinea?: string;
  nombreSublinea?: string;
  codigo: string;
  nombre: string;
  productoMarca?: string;
  descripcion?: string;
  unidadMedida: string;
  valorCritico: number;
  preCosto: number;
  preVenta: number;
  preVentaB: number | string;
  aplicaINV: "bien" | "servicio" | "S" | "N";
  cantidad: number;
  almacenNombre?: string;
  productoUbicacion?: string;
  maxCantVen?: number | string;
  usuario: string;
  estado: "ACTIVO" | "INACTIVO" | "archivado";
  images?: string[];
  unidadesAlternas?: ProductUnitOption[];
}

export interface ProductWarehouseItem {
  totalRegistros?: number;
  idStock: number;
  almacenId: number;
  almacenNombre: string;
  idProducto: number;
  productoCodigo: string;
  productoNombre: string;
  productoMarca?: string;
  descripcion: string;
  cantidad: number;
  productoUM: string;
  productoVenta: number;
  productoVentaB?: number;
  precioCosto?: number;
  valorUM?: number;
  valorCritico?: number;
  productoImagen?: string;
  productoUbicacion?: string;
  usuario?: string;
  fechaEdicion?: string;
  inversion?: number;
  esUnidadAlterna?: boolean;
}
