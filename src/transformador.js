function transformRawListings(rawListings) {

  // ---------- helpers ----------
  const normalize = (t) =>
    t
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/€/g, ' €')
      .trim();

  const matchInt = (regex, text) => {
    const m = text.match(regex);
    return m ? parseInt(m[1].replace('.', ''), 10) : null;
  };

  const matchBool = (regex, text) => regex.test(text);

  // ---------- parser ----------
  return rawListings.map(raw => {
    const text = normalize(raw.detalle);

    const locationMatch = text.match(/([A-Za-zÁÉÍÓÚñ\-]+),\s*(Madrid)/i);

    return {
      id: raw.id,

      // precio
      price_month: matchInt(/([\d\.]+)\s*€\/mes/i, text),
      currency: "EUR",

      // superficies
      built_area_sqm:
        matchInt(/(\d+)\s*m²\s*construidos/i, text) ??
        matchInt(/(\d+)\s*m²/i, text),

      // habitaciones / baños
      bedrooms: matchInt(/(\d+)\s*hab/i, text),
      bathrooms: matchInt(/(\d+)\s*baño/i, text),

      // planta
      floor: matchInt(/Planta\s*(\d+)/i, text),
      floor_position:
        /interior/i.test(text) ? "interior" :
        /exterior/i.test(text) ? "exterior" :
        null,

      has_elevator:
        /sin ascensor/i.test(text) ? false :
        /con ascensor/i.test(text) ? true :
        null,

      // ubicación
      neighborhood: locationMatch ? locationMatch[1] : null,
      city: locationMatch ? locationMatch[2] : null,

      // características
      furnished: matchBool(/Amueblado/i, text),
      kitchen_equipped: matchBool(/cocina equipada/i, text),
      air_conditioning: matchBool(/Aire acondicionado/i, text),

      heating_system: (() => {
        const m = text.match(/Calefacción\s+individual:\s*([^.\n]+)/i);
        if (!m) return null;
        const v = m[1].toLowerCase();
        if (v.includes("gas")) return "gas";
        if (v.includes("eléctr")) return "electric";
        if (v.includes("bomba")) return "heat_pump";
        return null;
      })(),

      rental_type:
        /Alquiler de temporada/i.test(text) ? "seasonal" : "long_term",

      max_occupancy: matchInt(/Máximo\s*(\d+)\s*personas/i, text)
    };
  });
}

import fs from "fs";

const rawJson = JSON.parse(
  fs.readFileSync("src/pisos/pisos_detalle.json", "utf8")
);

const structuredListings = transformRawListings(rawJson);

console.log(JSON.stringify(structuredListings, null, 2));