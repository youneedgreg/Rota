// Errors and receipt-check details in the reader's language. The packages
// raise English messages with stable `problem` codes; French text is chosen
// by code here, so the packages stay language-free. English keeps the
// packages' own, more specific messages.
import { CircleError, LnurlError, PriceError } from "@rota/circles";
import { InvoiceError } from "@rota/receipts";
import { CircleEventError } from "@rota/records";
import { NwcPolicyError, PaymentGuardError, VaultError } from "@rota/wallet";
import { translate, UiError, type Lang } from "./messages";

const LNURL_FR: Record<string, string> = {
  address: "Ce n'est pas une adresse Lightning.",
  network: "Impossible de joindre le service du bénéficiaire. Vérifiez votre connexion et réessayez.",
  response: "Le service du bénéficiaire a donné une réponse inutilisable. Rien n'a été payé.",
  service: "Le service du bénéficiaire a refusé : {reason}",
  identifier: "La facture n'est pas liée à l'adresse du bénéficiaire. Rien n'a été payé.",
  range: "Le montant est hors des limites acceptées par ce bénéficiaire.",
  invoice: "La facture est illisible. Rien n'a été payé.",
  amount: "La facture n'a pas le bon montant. Rien n'a été payé.",
  issuer: "La facture a été signée par un nœud inconnu. Rien n'a été payé.",
  expired: "La facture a expiré ou va expirer. Appuyez à nouveau sur Payer pour en obtenir une nouvelle.",
  rate: "Le taux de change du bénéficiaire est trop éloigné du prix du marché. Rien n'a été payé.",
};

const CIRCLE_FR: Record<string, string> = {
  name: "Le nom de la tontine doit compter de 1 à 60 caractères.",
  currency: "La devise doit être KES ou XOF.",
  contribution: "La cotisation doit être un montant entier, de 1 à 50 000 KES ou de 1 à 250 000 XOF.",
  "member-count": "Une tontine compte de 2 à 20 membres.",
  "member-id": "Identifiant de membre invalide.",
  "member-name": "Le nom d'un membre doit compter de 1 à 40 caractères.",
  "duplicate-member": "Chaque membre n'apparaît qu'une fois.",
  "payout-address": "L'adresse de versement doit être une adresse Lightning.",
  "duplicate-address": "Chaque membre a besoin de sa propre adresse de versement.",
  "mpesa-currency": "Les versements M-Pesa demandent une tontine en KES.",
  "mpesa-range": "Les paiements vers M-Pesa doivent être de 15 à 50 000 KES chacun.",
  "payout-order": "L'ordre des versements doit inclure chaque membre une seule fois.",
  schedule: "Le calendrier n'est pas valide. Vérifiez les dates et les durées.",
};

const GUARD_FR: Record<string, string> = {
  method: "Le portefeuille n'a pas reconnu une facture Lightning. Rien n'a été payé.",
  invoice: "Le portefeuille a proposé une autre facture. Rien n'a été payé.",
  amount: "Le portefeuille enverrait un autre montant. Rien n'a été payé.",
  fee: "Les frais de réseau dépassent la limite de Rota. Rien n'a été payé.",
  failed: "Le paiement a échoué. Aucun argent n'a quitté votre portefeuille.",
  pending: "Le paiement est toujours en cours. Rota vérifiera de nouveau sous peu.",
  preimage: "La preuve de paiement manque ou ne correspond pas à la facture.",
};

const NWC_FR: Record<string, string> = {
  methods: "Cette connexion peut faire plus que payer. Créez-en une qui peut seulement payer.",
  "no-pay": "Cette connexion ne peut pas payer de factures.",
  "no-budget":
    "Votre portefeuille n'a pas confirmé de limite de dépenses pour cette connexion. Rota n'accepte que les connexions avec une limite mensuelle.",
  renewal: "La limite de dépenses doit se renouveler chaque mois.",
  "too-large": "Cette connexion peut dépenser plus que ce que Rota demande. Créez-en une avec une limite mensuelle plus basse.",
  "too-small": "La limite mensuelle de cette connexion est trop basse pour payer une cotisation.",
  proof: "La preuve de paiement de votre portefeuille manque ou ne correspond pas à la facture.",
};

const VAULT_FR: Record<string, string> = {
  pin: "Ce code PIN est trop court.",
  words: "Ces mots de récupération ne sont pas valides. Vérifiez chaque mot et leur ordre.",
  locked: "Code PIN incorrect. Réessayez.",
  blob: "Le portefeuille enregistré sur cet appareil est endommagé.",
};

// CircleEventError has no code; its few messages are matched by their start.
const CIRCLE_EVENT_FR: [string, string][] = [
  ["Your name must", "Votre nom doit compter de 1 à 40 caractères."],
  ["That isn't a Lightning address", "Ce n'est ni une adresse Lightning ni un numéro de mobile kényan."],
  ["The payout address's node", "Le nœud de l'adresse de versement n'a pas pu être enregistré."],
  ["A circle has", "Une tontine compte de 2 à 20 membres."],
];

/** Plain-language text for any error, in the reader's language. Never a stack trace. */
export function explainError(error: unknown, lang: Lang): string {
  if (error instanceof UiError) return translate(lang, error.key, error.vars);
  if (lang === "fr") {
    let fr: string | undefined;
    if (error instanceof LnurlError) {
      fr = LNURL_FR[error.problem];
      // A wrong-network invoice also uses the "network" code; its message says so.
      if (error.problem === "network" && error.message.startsWith("Invoice refused")) {
        fr = "La facture est pour un autre réseau Bitcoin. Rien n'a été payé.";
      }
      if (fr && error.problem === "service") fr = fr.replace("{reason}", error.message.split(": ").slice(1).join(": "));
    } else if (error instanceof CircleError) fr = CIRCLE_FR[error.problem];
    else if (error instanceof PaymentGuardError) fr = GUARD_FR[error.problem];
    else if (error instanceof NwcPolicyError) fr = NWC_FR[error.problem];
    else if (error instanceof VaultError) fr = VAULT_FR[error.problem];
    else if (error instanceof PriceError) fr = "Aucun prix du bitcoin n'est disponible pour le moment. Réessayez dans une minute.";
    else if (error instanceof InvoiceError) fr = "Cette facture Lightning est illisible.";
    else if (error instanceof CircleEventError) fr = CIRCLE_EVENT_FR.find(([start]) => error.message.startsWith(start))?.[1];
    if (fr) return fr;
  }
  // Anything else (a wallet SDK, the network): its own message, which may be English.
  if (error instanceof Error && error.message) return error.message;
  return translate(lang, "error.generic");
}

const DETAIL_FR: Record<string, string> = {
  "preimage matches the payment hash": "la preuve correspond à l'empreinte du paiement",
  "preimage does not match the payment hash": "la preuve ne correspond pas à l'empreinte du paiement",
  "preimage is not 32 bytes of hex": "la preuve n'a pas le bon format",
  "invoice commits to the address's metadata": "la facture est liée aux métadonnées de l'adresse",
  "invoice's signed description names the address": "la description signée de la facture nomme l'adresse",
  "description hash does not match the address's metadata": "l'empreinte de la description ne correspond pas aux métadonnées de l'adresse",
  "invoice neither commits to the metadata nor names the address": "la facture n'est ni liée aux métadonnées ni à l'adresse",
  "metadata names a different address": "les métadonnées nomment une autre adresse",
  "metadata names no address": "les métadonnées ne nomment aucune adresse",
  "signed by the address's known node": "signée par le nœud connu de l'adresse",
  "invoice was signed by an unknown node": "la facture a été signée par un nœud inconnu",
  "no known node for this address": "aucun nœud connu pour cette adresse",
  "amount matches the round": "le montant correspond au tour",
  "contribution paid; sats within the band of today's price": "cotisation payée ; sats dans la marge du prix du jour",
  "invoice amount differs from the round's amount": "le montant de la facture diffère de celui du tour",
  "invoice has no amount": "la facture n'a pas de montant",
  "the round's amount is not positive": "le montant du tour n'est pas positif",
  "paid too few sats for the contribution at today's price": "trop peu de sats payés pour la cotisation au prix du jour",
  "paid far more sats than the contribution at today's price": "beaucoup plus de sats payés que la cotisation au prix du jour",
  "receipt doesn't claim the circle's contribution": "le reçu ne déclare pas la cotisation de la tontine",
  "no price to compare the amount with": "aucun prix pour comparer le montant",
  "signed by a member of this circle": "signé par un membre de cette tontine",
  "signed by someone outside this circle": "signé par quelqu'un hors de cette tontine",
  "not a Nostr event": "ce n'est pas un événement Nostr",
  "not a Rota receipt": "ce n'est pas un reçu Rota",
  "receipt belongs to another circle": "le reçu appartient à une autre tontine",
  "receipt couldn't be decrypted or read": "le reçu n'a pas pu être déchiffré ou lu",
  "receipt is for another round": "le reçu concerne un autre tour",
  "receipt is too large": "le reçu est trop volumineux",
  "receipt's content names another circle or round": "le contenu du reçu nomme une autre tontine ou un autre tour",
  "signature doesn't match the event": "la signature ne correspond pas à l'événement",
};

/** A receipt check's reason in the reader's language; unknown ones stay as they are. */
export function checkDetail(detail: string, lang: Lang): string {
  if (lang !== "fr") return detail;
  if (DETAIL_FR[detail]) return DETAIL_FR[detail];
  if (detail.startsWith("invoice is for network")) return "la facture est pour un autre réseau";
  return detail;
}
