// IP do cliente. Na Vercel, x-vercel-forwarded-for é definido pela própria Vercel e o cliente não consegue mudá-lo;
// x-real-ip e x-forwarded-for podem chegar com o que o cliente mandou. Por isso o primeiro vale sempre que existe (na Vercel,
// sempre); os outros dois só servem fora dela (desenvolvimento e testes), onde não há o que proteger.
export function ipDe(headers) {
  const h = (k) => (typeof headers[k] === "string" ? headers[k] : "");
  return (h("x-vercel-forwarded-for") || h("x-real-ip") || h("x-forwarded-for")).split(",")[0].trim().slice(0, 64);
}
