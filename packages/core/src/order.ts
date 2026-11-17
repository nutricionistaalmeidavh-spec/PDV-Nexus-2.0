/** Modelo de domínio puro. Persistência, autenticação e auditoria ficam na aplicação. */
export type ServiceMode = 'counter' | 'table' | 'takeaway' | 'delivery';
export type OrderStatus = 'DRAFT' | 'OPEN' | 'CLOSED' | 'CANCELLED';

export type OrderLine = Readonly<{
  id: string;
  productId: string;
  productName: string;
  unitPriceCents: number;
  quantity: number;
}>;

export type Order = Readonly<{
  id: string;
  serviceMode: ServiceMode;
  createdAt: string;
  status: OrderStatus;
  revision: number;
  lines: ReadonlyArray<OrderLine>;
}>;

const safeNonnegativeCents = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

export function createOrder(input: Pick<Order, 'id' | 'serviceMode' | 'createdAt'>): Order {
  if (!input.id.trim() || !input.createdAt.trim()) throw new Error('Identificação do pedido inválida');
  if (!(['counter', 'table', 'takeaway', 'delivery'] as string[]).includes(input.serviceMode)) {
    throw new Error('Tipo de atendimento inválido');
  }
  return { ...input, status: 'DRAFT', revision: 0, lines: [] };
}

export function addOrderLine(order: Order, line: OrderLine): Order {
  if (order.status === 'CLOSED' || order.status === 'CANCELLED') throw new Error('Pedido encerrado');
  if (!line.id.trim() || !line.productId.trim() || !line.productName.trim()) throw new Error('Item inválido');
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) throw new Error('quantidade inválida');
  if (!safeNonnegativeCents(line.unitPriceCents)) throw new Error('preço inválido');
  if (order.lines.some((existing) => existing.id === line.id)) throw new Error('ID de item duplicado');
  // snapshot impede alterações de cardápio de reprecificarem pedidos já feitos.
  return { ...order, revision: order.revision + 1, lines: [...order.lines, { ...line }] };
}

export function orderTotalCents(order: Order): number {
  return order.lines.reduce((total, line) => {
    const subtotal = line.unitPriceCents * line.quantity;
    if (!safeNonnegativeCents(subtotal) || !safeNonnegativeCents(total + subtotal)) {
      throw new Error('Total excedeu limite seguro de centavos');
    }
    return total + subtotal;
  }, 0);
}

export function confirmOrder(order: Order): Order {
  if (order.status !== 'DRAFT') throw new Error('Transição de estado inválida');
  if (!order.lines.length) throw new Error('Não é possível confirmar pedido vazio');
  orderTotalCents(order);
  return { ...order, status: 'OPEN', revision: order.revision + 1 };
}

/** settledCents é valor líquido conciliado, não valor entregue antes do troco. */
export function closeOrder(order: Order, settledCents: number): Order {
  if (order.status !== 'OPEN') throw new Error('Transição de estado inválida');
  if (!safeNonnegativeCents(settledCents) || settledCents !== orderTotalCents(order)) {
    throw new Error('Total de pagamento não confere com o pedido');
  }
  return { ...order, status: 'CLOSED', revision: order.revision + 1 };
}

export function cancelOrder(order: Order): Order {
  if (order.status !== 'DRAFT' && order.status !== 'OPEN') throw new Error('Transição de estado inválida');
  return { ...order, status: 'CANCELLED', revision: order.revision + 1 };
}
