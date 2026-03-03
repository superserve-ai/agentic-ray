import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const accordionMeta: ComponentMeta = {
  slug: "accordion",
  name: "Accordion",
  description: "Collapsible content sections.",
  category: "Data Display",
  source: "components/accordion.tsx",
  props: [],
  examples: [
    {
      title: "Default",
      preview: (
        <div className="max-w-lg">
          <Accordion type="single" collapsible>
            <AccordionItem value="item-1">
              <AccordionTrigger>What is Superserve?</AccordionTrigger>
              <AccordionContent>
                Superserve is a CLI and SDK for deploying AI agents to sandboxed cloud containers.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2">
              <AccordionTrigger>How do I deploy an agent?</AccordionTrigger>
              <AccordionContent>
                Use the superserve deploy command to deploy your agent to the cloud.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-3">
              <AccordionTrigger>Is there a free tier?</AccordionTrigger>
              <AccordionContent>
                Yes, you can get started with a generous free tier that includes sandbox hours.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      ),
      code: `<Accordion type="single" collapsible>
  <AccordionItem value="item-1">
    <AccordionTrigger>What is Superserve?</AccordionTrigger>
    <AccordionContent>
      Superserve is a CLI and SDK for deploying AI agents to sandboxed cloud containers.
    </AccordionContent>
  </AccordionItem>
  <AccordionItem value="item-2">
    <AccordionTrigger>How do I deploy an agent?</AccordionTrigger>
    <AccordionContent>
      Use the superserve deploy command to deploy your agent to the cloud.
    </AccordionContent>
  </AccordionItem>
  <AccordionItem value="item-3">
    <AccordionTrigger>Is there a free tier?</AccordionTrigger>
    <AccordionContent>
      Yes, you can get started with a generous free tier that includes sandbox hours.
    </AccordionContent>
  </AccordionItem>
</Accordion>`,
    },
  ],
}
