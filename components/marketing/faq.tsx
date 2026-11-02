import { Section, SectionHeading } from "@/components/marketing/shared";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { landing } from "@/content/landing";

/** FAQPage structured data, built from the same content as the visible list. */
function FaqJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: landing.faq.items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <script
      type="application/ld+json"
      // Escape "<" so the JSON can never close the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export function Faq() {
  const { faq } = landing;

  return (
    <Section id="faq" aria-labelledby="faq-title">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16">
        <SectionHeading
          id="faq-title"
          eyebrow={faq.eyebrow}
          title={faq.title}
          className="lg:sticky lg:top-28 lg:col-span-4 lg:self-start"
        />

        <Accordion type="single" collapsible className="lg:col-span-8">
          {faq.items.map((item) => (
            <AccordionItem key={item.id} value={item.id} className="border-b">
              <AccordionTrigger className="gap-4 py-5 text-base font-medium hover:no-underline md:text-lg">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="pb-5 text-sm leading-relaxed text-pretty text-muted-foreground md:text-base">
                <p>{item.answer}</p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      <FaqJsonLd />
    </Section>
  );
}
