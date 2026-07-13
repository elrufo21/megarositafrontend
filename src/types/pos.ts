export interface PosCartItem {
  productId: number;
  codigo: string;
  codigoSunat?: string;
  nombre: string;
  productoMarca?: string;
  unidadMedida?: string;
  costo?: number;
  precio: number;
  precioA?: number;
  precioB?: number;
  precioMinimo?: number;
  cantidad: number;
  valorUM?: number;
  stock?: number;
  detalleId?: number;
}

export interface PosTotals {
  subTotal: number;
  total: number;
  itemCount: number;
}
