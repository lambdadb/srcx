import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import org.apache.lucene.analysis.standard.StandardAnalyzer;
import org.apache.lucene.analysis.tokenattributes.CharTermAttribute;

// One base64 UTF-8 document per input line; tab-separated base64 tokens per output line.
class StandardTokens {
    public static void main(String[] args) throws Exception {
        try (var analyzer = new StandardAnalyzer();
             var input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = input.readLine()) != null) {
                var text = new String(Base64.getDecoder().decode(line), StandardCharsets.UTF_8);
                var tokens = new ArrayList<String>();
                try (var stream = analyzer.tokenStream("searchText", text)) {
                    var term = stream.addAttribute(CharTermAttribute.class);
                    stream.reset();
                    while (stream.incrementToken()) {
                        tokens.add(Base64.getEncoder().encodeToString(
                            term.toString().getBytes(StandardCharsets.UTF_8)));
                    }
                    stream.end();
                }
                System.out.println(String.join("\t", tokens));
            }
        }
    }
}
